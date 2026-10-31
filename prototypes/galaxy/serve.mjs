import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
]);
const port = Number(process.env.GALAXY_PORT ?? 4178);
createServer(async (req, res) => {
  const route = files.get(new URL(req.url, "http://localhost").pathname);
  if (!route || !["GET", "HEAD"].includes(req.method)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(new URL(route[0], import.meta.url));
    res.writeHead(200, {
      "Content-Type": route[1],
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; object-src 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(500);
    res.end("Preview unavailable");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Galaxy prototype: http://127.0.0.1:${port}`),
);
