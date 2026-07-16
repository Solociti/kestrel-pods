import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 8080);
const publicDir = join(process.cwd(), "public");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function resolvePublicPath(urlPath: string): string {
  const normalized = normalize(urlPath).replace(/^([.][.][/\\])+/, "");
  const safePath = normalized === "/" ? "/index.html" : normalized;
  return join(publicDir, safePath);
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const filePath = resolvePublicPath(requestUrl.pathname);
  const indexPath = resolvePublicPath("/");

  const selectedPath = existsSync(filePath) ? filePath : indexPath;

  try {
    const fileStat = await stat(selectedPath);
    if (!fileStat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const ext = extname(selectedPath);
    res.writeHead(200, {
      "content-type": mimeTypes[ext] ?? "application/octet-stream"
    });

    createReadStream(selectedPath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
});

server.listen(PORT, () => {
  console.log(`dashboard server listening on :${PORT}`);
});
