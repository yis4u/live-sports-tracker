import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pagesFetch } from "../hosting/pages-api";

test("GitHub Pages data stays local and returns explicitly fictional dashboards for all sports", async () => {
  for (const sport of ["football", "basketball", "baseball"]) {
    const response = await pagesFetch(
      `/api/dashboard?sport=${sport}&date=2026-11-03`,
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.sport, sport);
    assert.equal(data.date, "2026-11-03");
    assert.equal(data.mode, "demo");
    assert.match(data.notice, /fictional/);
    assert.equal(data.matches.length, 6);
  }
});

test("GitHub Pages adapter validates inputs and does not pretend that accounts are saved", async () => {
  for (const query of [
    "sport=hockey",
    "date=2026-02-30",
    "date=wrong",
    "sport=football&sport=baseball",
    "date=2026-11-02&date=2026-11-03",
  ])
    assert.equal((await pagesFetch(`/api/dashboard?${query}`)).status, 400);
  assert.equal((await pagesFetch("/api/unknown")).status, 404);
  assert.equal(
    (await pagesFetch("/api/dashboard", { method: "POST" })).status,
    405,
  );
  assert.deepEqual(await (await pagesFetch("/api/auth/me")).json(), {
    user: null,
    favorites: [],
    notificationsEnabled: false,
    storage: "unconfigured",
  });
  for (const [url, method] of [
    ["/api/auth/login", "POST"],
    ["/api/auth/register", "POST"],
    ["/api/auth/logout", "POST"],
    ["/api/favorites", "POST"],
    ["/api/favorites", "DELETE"],
    ["/api/preferences", "PATCH"],
  ]) {
    const result = await pagesFetch(url, { method });
    assert.equal(result.status, 503);
    assert.match(
      (await result.json()).error,
      /save favorite teams on this device/,
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    pagesFetch("/api/dashboard", { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("GitHub Pages build publishes the app and relative assets without server modules or API keys", async () => {
  await promisify(execFile)(process.execPath, ["scripts/build-pages.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PAGES_BASE_PATH: "/live-sports-tracker/" },
  });
  const output = path.join(process.cwd(), "pages-dist");
  const html = await readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /<title>Sideline · Live Sports Tracker<\/title>/);
  assert.match(html, /id="app"/);
  assert.match(html, /content="\/live-sports-tracker\/"/);
  assert.match(html, /src="\.\/assets\/app.js"/);
  assert.match(html, /href="\.\/assets\/app.css"/);
  assert.doesNotMatch(html, /README|<pre/);
  assert.ok((await readdir(output)).includes(".nojekyll"));
  const javascript = await readFile(path.join(output, "assets/app.js"), "utf8");
  assert.match(javascript, /live-sports-tracker/);
  assert.match(javascript, /fictional/);
  assert.doesNotMatch(
    javascript,
    /API_SPORTS_KEY|DATABASE_URL|x-apisports-key|v3\.football\.api-sports\.io/,
  );
  assert.ok(
    (await readFile(path.join(output, "assets/app.css"))).length > 1000,
  );
});
