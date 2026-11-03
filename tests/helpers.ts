import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

export async function fakePortal(handler: (request: http.IncomingMessage, body: any) => Promise<{ status?: number; body?: unknown }> | { status?: number; body?: unknown }) {
  const requests: Array<{ url: string; method: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ url: request.url || '/', method: request.method || 'GET', headers: request.headers, body });
    const result = await handler(request, body);
    response.statusCode = result.status ?? 200;
    if (result.status === 204) { response.end(); return; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result.body ?? {}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

export function tokenStore(initial = { access_token: 'test-access-token', expires_at: '2099-01-01T00:00:00.000Z', username: 'analista.teste' }) {
  let token: typeof initial | null = initial;
  return {
    backend: 'arquivo local' as const,
    read: async () => token,
    write: async (value: typeof initial) => { token = value; },
    clear: async () => { token = null; },
    peek: () => token,
  };
}
