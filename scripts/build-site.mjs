import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(root, ".openai/hosting.json"), "utf8"),
);
if (!manifest.project_id)
  throw new Error("Register the Site and persist project_id before building.");
const client = await build({
  absWorkingDir: root,
  entryPoints: ["hosting/client.tsx"],
  outfile: path.join(root, "dist/assets/app.js"),
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  tsconfig: path.join(root, "tsconfig.json"),
});
const javascript = client.outputFiles.find((file) =>
  file.path.endsWith(".js"),
)?.text;
const stylesheet = client.outputFiles.find((file) =>
  file.path.endsWith(".css"),
)?.text;
if (!javascript || !stylesheet)
  throw new Error("The application JavaScript or stylesheet was not emitted.");
const icon = await readFile(path.join(root, "app/icon.svg"), "utf8");
const assets = JSON.stringify({ javascript, stylesheet, icon });
const worker = await build({
  absWorkingDir: root,
  stdin: {
    contents: `import { createWorker } from "./hosting/worker.ts"; export default createWorker(${assets});`,
    sourcefile: "hosted-entry.ts",
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  outfile: path.join(root, "dist/server/index.js"),
  metafile: true,
});
if (
  Object.values(worker.metafile.outputs).some((output) => output.imports.length)
)
  throw new Error("The hosted Worker must be self-contained.");
await rm(path.join(root, "dist"), { recursive: true, force: true });
await mkdir(path.join(root, "dist/server"), { recursive: true });
await mkdir(path.join(root, "dist/.openai"), { recursive: true });
await writeFile(
  path.join(root, "dist/server/index.js"),
  worker.outputFiles[0].contents,
);
await writeFile(
  path.join(root, "dist/.openai/hosting.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `Built self-contained Site Worker (${worker.outputFiles[0].contents.length} bytes).`,
);
