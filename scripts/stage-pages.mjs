import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await mkdir(new URL("assets/", root), { recursive: true });
for (const path of [
  "index.html",
  "assets/app.js",
  "assets/app.css",
  "icon.svg",
  ".nojekyll",
]) {
  await copyFile(new URL(`pages-dist/${path}`, root), new URL(path, root));
}
console.log(
  "Staged the built website at the repository root for GitHub Pages.",
);
