import type { PlayerService } from '../music/player-service.ts';
import type { configuration } from '../config/index.ts';
import type { MusicInput } from '../music/types.ts';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { MusicError } from '../shared/music-error.ts';
const snowflake = (value: unknown) =>
  /^[1-9]\d{16,19}$/.test(typeof value === 'string' ? value : '');
export function createServer({
  config,
  service,
  ready = () => true,
}: {
  config: ReturnType<typeof configuration>;
  service: PlayerService;
  ready?: () => boolean;
}) {
  const limits = new Map<string, { count: number; until: number }>();
  const server = http.createServer(async (request, response) => {
    const json = (status: number, body: unknown) => {
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
      const expected = Buffer.from(config.secret || '');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new MusicError(401, 'Não autorizado.');
      if (request.url === '/health' && request.method === 'GET')
        return json(ready() ? 200 : 503, { ready: ready() });
      const match =
        /^\/v1\/guilds\/([1-9]\d{16,19})\/(search|state|enqueue|pause|resume|skip|stop|status|playlists|favorites|history|savePlaylist|createPlaylist|addToPlaylist|deletePlaylist|playlistEnqueue|favoriteEnqueue|historyEnqueue|favorite|remove|shuffle|deduplicate|repeat)$/.exec(
          request.url || '',
        );
      if (request.method !== 'POST' || !match)
        throw new MusicError(404, 'Recurso não encontrado.');
      if (!ready()) throw new MusicError(503, 'O bot está reconectando ao Discord.');
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 2048) throw new MusicError(413, 'Pedido muito grande.');
        chunks.push(chunk);
      }
      let input: MusicInput & { userId: string };
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
        json(error instanceof MusicError ? error.status : 502, {
          error:
            error instanceof MusicError
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
