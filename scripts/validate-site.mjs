import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../dist/server/index.js", import.meta.url),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(
    new URL("../dist/.openai/hosting.json", import.meta.url),
    "utf8",
  ),
);
assert.ok(manifest.project_id);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const worker = (await import(moduleUrl)).default;
assert.equal(typeof worker?.fetch, "function");
const page = await worker.fetch(new Request("https://sideline.example/"), {});
assert.equal(page.status, 200);
assert.match(page.headers.get("content-type"), /^text\/html/);
assert.match(await page.text(), /\/assets\/app\.js/);
const dashboard = await worker.fetch(
  new Request("https://sideline.example/api/dashboard?sport=football"),
  {},
);
assert.equal(dashboard.status, 200);
assert.equal((await dashboard.json()).mode, "demo");
console.log(
  "Site artifact is valid ESM and serves the application and dashboard API.",
);
