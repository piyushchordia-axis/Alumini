// Minimal static server with SPA fallback for the exported Expo web bundle.
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const port = Number(process.argv[3] || 8081);
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
http
  .createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = path.join(root, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1");
