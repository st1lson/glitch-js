/**
 * A minimal upstream that streams Server-Sent Events.
 *
 * Glitch's realtime chaos only engages on SSE and WebSocket traffic, and its
 * JSON database engine serves neither. Running Glitch as a reverse proxy in
 * front of this origin is what makes that code path reachable from a test.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.SSE_ORIGIN_PORT ?? 3103);

/** Number of events a stream emits before closing. */
const EVENT_COUNT = 20;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }

  if (url.pathname !== '/events') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let sent = 0;
  const timer = setInterval(() => {
    if (sent >= EVENT_COUNT) {
      clearInterval(timer);
      res.end();
      return;
    }

    // The sequence number lets a test detect drops and reordering without
    // depending on timing.
    res.write(`id: ${sent}\ndata: {"seq":${sent}}\n\n`);
    sent += 1;
  }, 10);

  req.on('close', () => clearInterval(timer));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`sse-origin listening on ${PORT}\n`);
});
