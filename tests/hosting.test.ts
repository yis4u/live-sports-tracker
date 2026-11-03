import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../hosting/worker";

const assets = {
  javascript: "console.log('Sideline application')",
  stylesheet: "body { background: #f6f8f7; }",
  icon: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
};
const origin = "https://sideline.example.test";
const request = (path: string, init?: RequestInit) =>
  new Request(`${origin}${path}`, init);

test("hosted root serves the application shell and typed assets, with safe HEAD and cache headers", async () => {
  const worker = createWorker(assets);
  const home = await worker.fetch(request("/"));
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") || "", /^text\/html/);
  const html = await home.text();
  assert.match(html, /id="app"/);
  assert.match(html, /src="\/assets\/app.js"/);
  assert.match(html, /href="\/assets\/app.css"/);
  assert.match(html, /<title>Sideline · Live Sports Tracker<\/title>/);
  assert.doesNotMatch(html, /README|# Live Sports/);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(
    home.headers.get("content-security-policy") || "",
    /script-src 'self'/,
  );
  assert.match(home.headers.get("cache-control") || "", /must-revalidate/);
  for (const [path, content, type] of [
    ["/assets/app.js", assets.javascript, "text/javascript"],
    ["/assets/app.css", assets.stylesheet, "text/css"],
    ["/icon.svg", assets.icon, "image/svg+xml"],
  ]) {
    const response = await worker.fetch(request(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type")?.startsWith(type), true);
    assert.equal(await response.text(), content);
    const head = await worker.fetch(request(path, { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("content-type"),
      response.headers.get("content-type"),
    );
  }
});

test("hosted API serves honest demo dashboards for all three sports without browser caching", async () => {
  const worker = createWorker(assets);
  for (const sport of ["football", "basketball", "baseball"]) {
    const response = await worker.fetch(
      request(`/api/dashboard?sport=${sport}&date=2026-11-03`),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.sport, sport);
    assert.equal(body.date, "2026-11-03");
    assert.equal(body.mode, "demo");
    assert.match(body.notice, /fictional/);
    assert.equal(body.matches.length, 6);
    assert.equal(body.players.length, 6);
  }
});

test("hosted API rejects invalid or duplicate queries and returns true 404 and 405 responses", async () => {
  const worker = createWorker(assets);
  for (const query of [
    "sport=hockey",
    "date=2026-02-30",
    "sport=football&sport=baseball",
    "date=2026-11-03&date=2026-11-04",
  ]) {
    const response = await worker.fetch(request(`/api/dashboard?${query}`));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
  for (const path of [
    "/README.md",
    "/not-a-page",
    "/assets/missing.js",
    "/api/not-a-route",
  ]) {
    const response = await worker.fetch(request(path));
    assert.equal(response.status, 404);
    assert.match(
      response.headers.get("content-type") || "",
      /application\/json/,
    );
  }
  const method = await worker.fetch(request("/", { method: "POST" }));
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");
});

test("hosted accounts disclose unconfigured storage and refuse profile writes without false success", async () => {
  const worker = createWorker(assets);
  const response = await worker.fetch(request("/api/auth/me"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    user: null,
    favorites: [],
    notificationsEnabled: false,
    storage: "unconfigured",
  });
  for (const [path, method] of [
    ["/api/auth/register", "POST"],
    ["/api/auth/login", "POST"],
    ["/api/auth/logout", "POST"],
    ["/api/favorites", "POST"],
    ["/api/favorites", "DELETE"],
    ["/api/preferences", "PATCH"],
  ]) {
    const result = await worker.fetch(
      request(path, { method, headers: { Origin: origin } }),
    );
    assert.equal(result.status, 503);
    assert.match(
      (await result.json()).error,
      /save favorite teams on this device/,
    );
  }
  const rejected = await worker.fetch(
    request("/api/auth/register", {
      method: "POST",
      headers: { Origin: "https://other.example.test" },
    }),
  );
  assert.equal(rejected.status, 403);
});

test("hosted live mode has a per-instance quota guard and never disguises configuration errors as demo", async () => {
  const worker = createWorker(assets);
  const env = { API_SPORTS_KEY: "not-a-real-key" };
  for (let index = 0; index < 30; index++) {
    const result = await worker.fetch(
      request("/api/dashboard?sport=football"),
      env,
    );
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /Configure FOOTBALL/);
  }
  const limited = await worker.fetch(
    request("/api/dashboard?sport=baseball"),
    env,
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(limited.headers.get("cache-control"), "no-store");
  const demo = await worker.fetch(request("/api/dashboard?sport=baseball"));
  assert.equal(demo.status, 200);
  assert.equal((await demo.json()).mode, "demo");
});
