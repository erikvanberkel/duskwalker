// Tiny zero-dependency static server for playing Duskwalker in a browser.
// Usage: node serve.mjs [port]   then open http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = normalize(join(root, rel));
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Duskwalker running at http://localhost:${port}`));
