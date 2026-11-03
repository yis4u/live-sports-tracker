import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "pages-dist");
const parts = (process.env.PAGES_BASE_PATH ?? "/live-sports-tracker/")
  .split("/")
  .filter(Boolean);
if (parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)))
  throw new Error("PAGES_BASE_PATH must contain only valid path segments.");
const basePath = parts.length ? `/${parts.join("/")}/` : "/";
const client = await build({
  absWorkingDir: root,
  entryPoints: ["hosting/pages-client.tsx"],
  outfile: path.join(directory, "assets/app.js"),
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"',
    __PAGES_BASE_PATH__: JSON.stringify(basePath),
  },
  tsconfig: path.join(root, "tsconfig.json"),
  metafile: true,
});
if (
  Object.keys(client.metafile.inputs).some((input) =>
    /(?:^|\/)lib\/(?:sports|db|auth|http)\.ts$/.test(input),
  )
)
  throw new Error("Server modules must not be bundled into GitHub Pages.");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="sideline-base-path" content="${basePath}"><meta name="description" content="Explore football, basketball and baseball in Sideline, your multi-sport match center."><meta name="theme-color" content="#1b2a28"><title>Sideline · Live Sports Tracker</title><link rel="icon" href="./icon.svg" type="image/svg+xml"><link rel="stylesheet" href="./assets/app.css"></head><body><div id="app"></div><noscript><main><h1>Sideline · Live Sports Tracker</h1><p>Enable JavaScript to explore scores, standings, players and your favorite teams.</p></main></noscript><script type="module" src="./assets/app.js"></script></body></html>`;
await rm(directory, { recursive: true, force: true });
await mkdir(path.join(directory, "assets"), { recursive: true });
for (const file of client.outputFiles)
  await writeFile(file.path, file.contents);
await writeFile(path.join(directory, "index.html"), html);
await writeFile(
  path.join(directory, "icon.svg"),
  await readFile(path.join(root, "app/icon.svg")),
);
await writeFile(path.join(directory, ".nojekyll"), "");
console.log(`Built GitHub Pages app in pages-dist for ${basePath}`);
