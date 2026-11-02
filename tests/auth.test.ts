import test from "node:test";
import assert from "node:assert/strict";
import {
  favoriteSchema,
  hashPassword,
  hashSessionToken,
  loginSchema,
  parseInput,
  registerSchema,
  sessionTokenFromRequest,
  verifyPassword,
} from "../lib/auth";
import {
  ApiError,
  assertSameOrigin,
  consumeRateLimit,
  readJson,
} from "../lib/http";

test("password hashes are salted and wrong passwords do not authenticate", async () => {
  const password = "correct horse battery staple";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(password, "broken"), false);
  assert.equal(await verifyPassword(password, "scrypt$xx$deadbeef"), false);
});

test("authentication validates passwords, normalizes email and rejects unexpected fields", () => {
  assert.deepEqual(
    parseInput(loginSchema, {
      email: " User@Example.com ",
      password: "password12345",
    }),
    { email: "user@example.com", password: "password12345" },
  );
  for (const password of ["short", "x".repeat(129)]) {
    assert.throws(
      () => parseInput(registerSchema, { email: "user@example.com", password }),
      ApiError,
    );
  }
  assert.throws(
    () =>
      parseInput(registerSchema, {
        email: "user@example.com",
        password: "password12345",
        userId: "other",
      }),
    ApiError,
  );
  assert.throws(
    () =>
      parseInput(favoriteSchema, {
        sport: "football",
        teamId: "x';DROP TABLE users",
      }),
    ApiError,
  );
  assert.throws(
    () => parseInput(favoriteSchema, { sport: "hockey", teamId: "1" }),
    ApiError,
  );
});

test("only well formed session cookies are accepted and storage uses a one-way hash", () => {
  const token = "a".repeat(43);
  assert.equal(
    sessionTokenFromRequest(
      new Request("https://app.test", {
        headers: { cookie: `other=1; scoreboard_session=${token}` },
      }),
    ),
    token,
  );
  assert.equal(
    sessionTokenFromRequest(
      new Request("https://app.test", {
        headers: { cookie: "scoreboard_session=short" },
      }),
    ),
    null,
  );
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});

test("mutation origin checks reject cross-origin and missing-origin requests", () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  try {
    assert.doesNotThrow(() =>
      assertSameOrigin(
        new Request("https://app.test/api/auth/login", {
          headers: { origin: "https://app.test" },
        }),
      ),
    );
    assert.throws(
      () =>
        assertSameOrigin(
          new Request("https://app.test/api/auth/login", {
            headers: { origin: "https://evil.test" },
          }),
        ),
      ApiError,
    );
    assert.throws(
      () => assertSameOrigin(new Request("https://app.test/api/auth/login")),
      ApiError,
    );
    assert.throws(
      () =>
        assertSameOrigin(
          new Request("https://app.test/api/auth/login", {
            headers: {
              origin: "https://app.test",
              "sec-fetch-site": "cross-site",
            },
          }),
        ),
      ApiError,
    );
    process.env.APP_ORIGIN = "https://canonical.test";
    assert.doesNotThrow(() =>
      assertSameOrigin(
        new Request("http://internal:3000/api/auth/login", {
          headers: { origin: "https://canonical.test" },
        }),
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test("rate limit stops repeated requests and resets on expiry", () => {
  const key = `test:${Date.now()}`;
  consumeRateLimit(key, 2, 100, 1_000);
  consumeRateLimit(key, 2, 100, 1_050);
  assert.throws(() => consumeRateLimit(key, 2, 100, 1_060), ApiError);
  assert.doesNotThrow(() => consumeRateLimit(key, 2, 100, 1_101));
});

test("JSON parser rejects invalid, non-JSON and oversized requests", async () => {
  const json = (body: string) =>
    new Request("https://app.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  assert.deepEqual(await readJson(json('{"ok":true}')), { ok: true });
  await assert.rejects(readJson(json("bad")), ApiError);
  await assert.rejects(
    readJson(json(JSON.stringify("a".repeat(17_000)))),
    ApiError,
  );
  await assert.rejects(
    readJson(new Request("https://app.test", { method: "POST", body: "text" })),
    ApiError,
  );
});
