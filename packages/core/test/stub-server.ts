/**
 * A stand-in for the Glitch control API.
 *
 * It records what the SDK sent and replies with the same shapes the Go handler
 * does, which is enough to test the client without building the binary. The
 * integration suite under sdk/playwright/e2e covers the real server.
 */

import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface StubServer {
  url: string;
  requests: RecordedRequest[];
  /** Forces the next response, whatever the route would normally return. */
  respondNextWith(status: number, body: string): void;
  close(): Promise<void>;
}

export async function startStubServer(): Promise<StubServer> {
  const requests: RecordedRequest[] = [];
  let override: { status: number; body: string } | undefined;

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '';
      requests.push({
        method: req.method ?? '',
        path,
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      if (override) {
        const { status, body } = override;
        override = undefined;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      const [route] = path.split('?');
      const scenario = req.headers['x-glitch-scenario'];
      res.writeHead(200, { 'Content-Type': 'application/json' });

      switch (`${req.method} ${route}`) {
        case 'GET /_glitch/health':
          res.end(JSON.stringify({ status: 'ok', paused: false, scenario: scenario ?? '' }));
          return;
        case 'DELETE /_glitch/rules':
          res.end(JSON.stringify({ message: 'reset to baseline' }));
          return;
        case 'POST /_glitch/pause':
          res.end(JSON.stringify({ message: 'paused' }));
          return;
        case 'POST /_glitch/resume':
          res.end(JSON.stringify({ message: 'resumed' }));
          return;
        case 'GET /_glitch/report':
          res.end('null');
          return;
        default:
          res.end(JSON.stringify({ ok: true }));
      }
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondNextWith(status, body) {
      override = { status, body };
    },
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}
