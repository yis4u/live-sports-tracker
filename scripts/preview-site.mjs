import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(
  new URL("../dist/server/index.js", import.meta.url),
);
const worker = (await import(pathToFileURL(entry).href)).default;
const port = Number(process.env.PORT || "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid port number.");

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 16_384) {
        outgoing.writeHead(413, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end(JSON.stringify({ error: "Request body is too large." }));
        return;
      }
      chunks.push(chunk);
    }
    const method = incoming.method || "GET";
    const request = new Request(
      new URL(
        incoming.url || "/",
        `http://${incoming.headers.host || `localhost:${port}`}`,
      ),
      {
        method,
        headers: incoming.headers,
        ...(method === "GET" || method === "HEAD"
          ? {}
          : { body: Buffer.concat(chunks) }),
      },
    );
    const result = await worker.fetch(request, process.env);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    outgoing.end(
      JSON.stringify({ error: "The preview request could not be completed." }),
    );
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Sideline preview: http://localhost:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
