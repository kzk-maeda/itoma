import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../dist/demo/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = resolve(root, '.' + pathname);
    if (!target.startsWith(root)) throw Error('path');
    try { if ((await stat(target)).isDirectory()) target += '/index.html'; }
    catch { if (!extname(target)) target += '.html'; }
    const data = await readFile(target);
    response.writeHead(200, { 'content-type': mime[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(Number(process.env.DEMO_QA_PORT ?? 8798), '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + (process.env.DEMO_QA_PORT ?? 8798)));
