import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // web/
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves web/ over http://127.0.0.1 (a secure context, like GitHub Pages' https): the app at
 * /app/ and the test helpers at /test/.
 *
 * @param {number} port 0 picks a free one
 * @returns {Promise<{url: string, close: () => void}>}
 */
export function startServer(port = 0) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      response.writeHead(404).end('No encontrado');
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ url: `http://127.0.0.1:${address.port}`, close: () => server.close() });
    });
  });
}

// `npm run serve`: try the app in a desktop browser (Chrome or Edge) at the printed address.
if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const { url } = await startServer(Number(process.env.PORT ?? 8080));
  console.log(`PitPat Controller web: ${url}/app/`);
}
