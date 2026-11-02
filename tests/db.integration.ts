/**
 * Explicit, destructive-to-test-records-only PostgreSQL integration check.
 * Run against a dedicated test database:
 * TEST_DATABASE_URL=postgresql://.../sideline_test node --import tsx tests/db.integration.ts
 * The application schema is migrated; generated test accounts are removed afterward.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const testUrl = process.env.TEST_DATABASE_URL;

test(
  "PostgreSQL accounts, ownership, sessions, preferences and migrations",
  { skip: !testUrl },
  async () => {
    assert.ok(testUrl);
    const parsed = new URL(testUrl);
    assert.match(
      parsed.pathname,
      /test/i,
      "Use a dedicated database whose name contains test.",
    );
    process.env.DATABASE_URL = testUrl;
    process.env.APP_ORIGIN = "https://sideline.test";

    for (let i = 0; i < 2; i++) {
      const migration: ReturnType<typeof spawnSync> = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/migrate.ts"],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: testUrl },
          encoding: "utf8",
        },
      );
      assert.equal(
        migration.status,
        0,
        `Migration ${i + 1} failed: ${migration.stderr}`,
      );
    }

    const [
      dbModule,
      register,
      login,
      me,
      logout,
      favorites,
      preferences,
      auth,
    ] = await Promise.all([
      import("../lib/db"),
      import("../app/api/auth/register/route"),
      import("../app/api/auth/login/route"),
      import("../app/api/auth/me/route"),
      import("../app/api/auth/logout/route"),
      import("../app/api/favorites/route"),
      import("../app/api/preferences/route"),
      import("../lib/auth"),
    ]);
    const db = dbModule.getDatabase();
    const suffix = randomUUID();
    const emails = [
      `qa-a-${suffix}@example.test`,
      `qa-b-${suffix}@example.test`,
    ];
    const password = "integration password 12345";
    const request = (
      path: string,
      method: string,
      body?: unknown,
      cookie?: string,
      origin = "https://sideline.test",
    ) => {
      const headers: Record<string, string> = { origin };
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      return new Request(`https://sideline.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };
    const cookieFrom = (response: Response) => {
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      return cookie.split(";")[0];
    };

    try {
      const migrations = await db.query(
        "SELECT name FROM schema_migrations ORDER BY name",
      );
      assert.equal(
        migrations.rows.filter((row) => row.name === "001_accounts.sql").length,
        1,
      );

      const accountA = await register.POST(
        request("/api/auth/register", "POST", {
          email: emails[0],
          password,
          name: "QA Alpha",
        }),
      );
      assert.equal(accountA.status, 201);
      const aCookie = cookieFrom(accountA);
      const a = await accountA.json();
      assert.equal(a.user.email, emails[0]);
      assert.equal(a.storage, "postgres");
      assert.deepEqual(a.favorites, []);

      const accountB = await register.POST(
        request("/api/auth/register", "POST", {
          email: emails[1],
          password,
          name: "QA Beta",
        }),
      );
      assert.equal(accountB.status, 201);
      const bCookie = cookieFrom(accountB);
      const b = await accountB.json();
      assert.notEqual(a.user.id, b.user.id);

      const duplicate = await register.POST(
        request("/api/auth/register", "POST", { email: emails[0], password }),
      );
      assert.equal(duplicate.status, 409);
      const wrongPassword = await login.POST(
        request("/api/auth/login", "POST", {
          email: emails[0],
          password: "this is incorrect",
        }),
      );
      assert.equal(wrongPassword.status, 401);
      const correctLogin = await login.POST(
        request("/api/auth/login", "POST", {
          email: emails[0].toUpperCase(),
          password,
        }),
      );
      assert.equal(correctLogin.status, 200);
      const loginCookie = cookieFrom(correctLogin);
      assert.notEqual(
        loginCookie,
        aCookie,
        "Signing in rotates the session token.",
      );

      const stored = await db.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [a.user.id],
      );
      assert.notEqual(stored.rows[0].password_hash, password);
      assert.equal(
        await auth.verifyPassword(password, stored.rows[0].password_hash),
        true,
      );
      const rawToken = loginCookie.split("=")[1];
      const session = await db.query(
        "SELECT token_hash, expires_at FROM sessions WHERE token_hash = $1",
        [auth.hashSessionToken(rawToken)],
      );
      assert.equal(session.rowCount, 1);
      assert.notEqual(session.rows[0].token_hash, rawToken);
      assert.ok(session.rows[0].expires_at.getTime() > Date.now());

      const add = await favorites.POST(
        request(
          "/api/favorites",
          "POST",
          { sport: "football", teamId: "qa-team" },
          loginCookie,
        ),
      );
      assert.equal(add.status, 200);
      assert.deepEqual((await add.json()).favorites, [
        { sport: "football", teamId: "qa-team" },
      ]);
      const duplicateAdd = await favorites.POST(
        request(
          "/api/favorites",
          "POST",
          { sport: "football", teamId: "qa-team" },
          loginCookie,
        ),
      );
      assert.equal(duplicateAdd.status, 200);
      assert.equal((await duplicateAdd.json()).favorites.length, 1);

      const aState = await (
        await me.GET(request("/api/auth/me", "GET", undefined, loginCookie))
      ).json();
      const bState = await (
        await me.GET(request("/api/auth/me", "GET", undefined, bCookie))
      ).json();
      assert.equal(aState.favorites.length, 1);
      assert.equal(
        bState.favorites.length,
        0,
        "Another account cannot read a user's favorites.",
      );
      const bDelete = await favorites.DELETE(
        request(
          "/api/favorites?sport=football&teamId=qa-team",
          "DELETE",
          undefined,
          bCookie,
        ),
      );
      assert.equal(bDelete.status, 200);
      const stillA = await (
        await me.GET(request("/api/auth/me", "GET", undefined, loginCookie))
      ).json();
      assert.equal(
        stillA.favorites.length,
        1,
        "Another account cannot delete a user's favorite.",
      );

      const preference = await preferences.PATCH(
        request(
          "/api/preferences",
          "PATCH",
          { notificationsEnabled: true },
          loginCookie,
        ),
      );
      assert.equal(preference.status, 200);
      const aPreferences = await (
        await me.GET(request("/api/auth/me", "GET", undefined, loginCookie))
      ).json();
      const bPreferences = await (
        await me.GET(request("/api/auth/me", "GET", undefined, bCookie))
      ).json();
      assert.equal(aPreferences.notificationsEnabled, true);
      assert.equal(bPreferences.notificationsEnabled, false);

      const unauthorized = await favorites.POST(
        request("/api/favorites", "POST", {
          sport: "football",
          teamId: "other",
        }),
      );
      assert.equal(unauthorized.status, 401);
      const csrf = await favorites.POST(
        request(
          "/api/favorites",
          "POST",
          { sport: "football", teamId: "other" },
          loginCookie,
          "https://other.test",
        ),
      );
      assert.equal(csrf.status, 403);
      const malformed = await favorites.POST(
        request(
          "/api/favorites",
          "POST",
          { sport: "football", teamId: "other", userId: b.user.id },
          loginCookie,
        ),
      );
      assert.equal(
        malformed.status,
        400,
        "The client cannot supply an ownership ID.",
      );

      const remove = await favorites.DELETE(
        request(
          "/api/favorites?sport=football&teamId=qa-team",
          "DELETE",
          undefined,
          loginCookie,
        ),
      );
      assert.equal(remove.status, 200);
      assert.deepEqual((await remove.json()).favorites, []);

      const signout = await logout.POST(
        request("/api/auth/logout", "POST", undefined, loginCookie),
      );
      assert.equal(signout.status, 200);
      assert.match(signout.headers.get("set-cookie") || "", /Max-Age=0/);
      const signedOutState = await (
        await me.GET(request("/api/auth/me", "GET", undefined, loginCookie))
      ).json();
      assert.equal(signedOutState.user, null);
      const invalidated = await db.query(
        "SELECT token_hash FROM sessions WHERE token_hash = $1",
        [auth.hashSessionToken(rawToken)],
      );
      assert.equal(invalidated.rowCount, 0);
    } finally {
      await db.query("DELETE FROM users WHERE email = ANY($1::text[])", [
        emails,
      ]);
      await db.end();
    }
  },
);
