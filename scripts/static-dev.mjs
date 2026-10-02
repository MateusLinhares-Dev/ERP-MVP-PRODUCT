import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 3001);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || '/').split('?')[0]);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = resolve(join(root, normalized));
  return full.startsWith(root) ? full : null;
}

const server = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    res.statusCode = 404;
    res.end('Vercel Function route');
    return;
  }

  let file = safeFile(req.url);
  if (!file) {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) file = join(root, 'index.html');

  res.setHeader('Content-Type', mime[extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[STATIC] ERP servido de ${root} na porta ${port}`);
});
