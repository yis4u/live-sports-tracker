import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../pages-dist/", import.meta.url));
const html = await readFile(path.join(directory, "index.html"), "utf8");
const basePath =
  html.match(/name="sideline-base-path" content="([^"]+)"/)?.[1] ?? "/";
const port = Number(process.env.PORT || "8788");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid port number.");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const server = createServer(async (request, response) => {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { ...headers, Allow: "GET, HEAD" });
    response.end();
    return;
  }
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" && basePath !== "/") {
      response.writeHead(302, { ...headers, Location: basePath });
      response.end();
      return;
    }
    if (!pathname.startsWith(basePath)) throw new Error("Not found");
    const relative = pathname.slice(basePath.length) || "index.html";
    const target = path.resolve(directory, relative);
    if (
      !target.startsWith(`${path.resolve(directory)}${path.sep}`) ||
      !(await stat(target)).isFile()
    )
      throw new Error("Not found");
    response.writeHead(200, {
      ...headers,
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
    });
    response.end(
      request.method === "HEAD" ? undefined : await readFile(target),
    );
  } catch {
    response.writeHead(404, {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : "Page not found.");
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`GitHub Pages preview: http://localhost:${port}${basePath}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
