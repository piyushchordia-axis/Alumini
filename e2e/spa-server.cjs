// Minimal static server with SPA fallback for the exported Expo web bundle (127.0.0.1 only, for the e2e scripts).
//   node e2e/spa-server.cjs e2e/.expo-web 8081      (or: pnpm e2e:mobile:serve)
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || path.join(__dirname, ".expo-web"));
const port = Number(process.argv[3] || 8081);
const index = path.join(root, "index.html");
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };

if (!fs.existsSync(index)) {
  console.error(`No exported app in ${root}. Run first: pnpm e2e:mobile:export`);
  process.exit(1);
}

/** Maps a request path to a file inside root; anything else (unknown routes, ../ escapes) gets the SPA's index.html. */
function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return index;
  }
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded.replace(/\\/g, "/")}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return index;
  try {
    return fs.statSync(file).isFile() ? file : index;
  } catch {
    return index;
  }
}

http
  .createServer((req, res) => {
    const file = resolveFile(req.url || "/");
    const stream = fs.createReadStream(file);
    stream.once("open", () => {
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      stream.pipe(res);
    });
    stream.once("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Serving ${root} on http://localhost:${port}`));
