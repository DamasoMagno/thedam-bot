import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { MusicError } from './error.js';
const snowflake = (value) => /^[1-9]\d{16,19}$/.test(value || '');
export function createServer({ config, service, ready = () => true }) {
  const limits = new Map();
  const server = http.createServer(async (request, response) => {
    const json = (status, body) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(body));
    };
    try {
      const supplied = Buffer.from(
        (request.headers.authorization || '').replace(/^Bearer /, ''),
      );
      const expected = Buffer.from(config.secret);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new MusicError(401, 'Não autorizado.');
      if (request.url === '/health' && request.method === 'GET')
        return json(ready() ? 200 : 503, { ready: ready() });
      const match =
        /^\/v1\/guilds\/([1-9]\d{16,19})\/(search|state|enqueue|pause|resume|skip|stop)$/.exec(
          request.url,
        );
      if (request.method !== 'POST' || !match)
        throw new MusicError(404, 'Recurso não encontrado.');
      if (!ready()) throw new MusicError(503, 'O bot está reconectando ao Discord.');
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 2048) throw new MusicError(413, 'Pedido muito grande.');
        chunks.push(chunk);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        throw new MusicError(400, 'JSON inválido.');
      }
      if (!input || !snowflake(input.userId))
        throw new MusicError(400, 'Usuário inválido.');
      const key = input.userId;
      if (limits.size > 1000)
        for (const [id, value] of limits)
          if (value.until < Date.now()) limits.delete(id);
      let limit = limits.get(key);
      if (!limit || limit.until < Date.now()) {
        limit = { count: 0, until: Date.now() + 60000 };
        limits.set(key, limit);
      }
      if (++limit.count > 90)
        throw new MusicError(429, 'Aguarde antes de tentar novamente.');
      json(200, await service.run(match[1], input.userId, match[2], input));
    } catch (error) {
      if (!response.headersSent)
        json(error.status || 502, {
          error: error.status
            ? error.message
            : 'O serviço de música está indisponível.',
        });
      else response.destroy();
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  return server;
}
