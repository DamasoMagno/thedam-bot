import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createSpotifyAuthorization({
  clientId,
  clientSecret,
  redirectUri = 'http://127.0.0.1:8890/callback',
  fetchImpl = fetch,
}: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
}) {
  if (!clientId || !clientSecret)
    throw new Error('Preencha SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET no .env.');
  const redirect = new URL(redirectUri);
  if (
    redirect.protocol !== 'http:' ||
    redirect.hostname !== '127.0.0.1' ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  )
    throw new Error('Use um callback local como http://127.0.0.1:8890/callback.');
  const state = randomBytes(24).toString('hex');
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect.href,
    state,
    scope: 'playlist-read-private playlist-read-collaborative',
  }).toString();
  let used = false;
  return {
    url: url.href,
    redirect,
    async exchange(callback: URL) {
      if (
        used ||
        callback.origin !== redirect.origin ||
        callback.pathname !== redirect.pathname ||
        callback.searchParams.get('state') !== state
      )
        throw new Error('Retorno de autorização inválido ou já utilizado.');
      const code = callback.searchParams.get('code');
      if (callback.searchParams.get('error') || !code)
        throw new Error('A autorização do Spotify não foi concluída.');
      used = true;
      const response = await fetchImpl('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirect.href,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(
          'O Spotify recusou a autorização. Confira o Redirect URI no painel e tente novamente.',
        );
      const data = await response.json();
      if (
        typeof data.refresh_token !== 'string' ||
        !data.refresh_token ||
        /[\r\n]/u.test(data.refresh_token)
      )
        throw new Error('O Spotify não retornou uma autorização renovável.');
      return data.refresh_token as string;
    },
  };
}
export function saveSpotifyAuthorization(path: string, token: string) {
  if (!token || /[\r\n]/u.test(token)) throw new Error('Autorização inválida.');
  const previous = readFileSync(path, 'utf8');
  const line = 'SPOTIFY_REFRESH_TOKEN=' + JSON.stringify(token);
  const contents = /^SPOTIFY_REFRESH_TOKEN=.*$/mu.test(previous)
    ? previous.replace(/^SPOTIFY_REFRESH_TOKEN=.*$/mu, () => line)
    : previous.trimEnd() + '\n' + line + '\n';
  const temporary = path + '.spotify-' + randomBytes(8).toString('hex');
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
async function main() {
  const authorization = createSpotifyAuthorization({
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  });
  let busy = false;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Referrer-Policy', 'no-referrer');
    let callback: URL;
    try {
      callback = new URL(request.url || '/', authorization.redirect);
    } catch {
      response.writeHead(400).end('Retorno inválido.');
      return;
    }
    if (
      request.method !== 'GET' ||
      callback.pathname !== authorization.redirect.pathname
    ) {
      response.writeHead(404).end('Não encontrado.');
      return;
    }
    if (busy) {
      response.writeHead(409).end('Autorização em andamento.');
      return;
    }
    busy = true;
    try {
      const token = await authorization.exchange(callback);
      saveSpotifyAuthorization(resolve('.env'), token);
      response.end(
        'Spotify conectado. Pode fechar esta página e reiniciar o bot para carregar a autorização.',
      );
      console.log(
        'Spotify conectado; autorização salva no .env sem exibir a credencial. Reinicie o bot.',
      );
      clearTimeout(timeout);
      server.close();
    } catch (error) {
      busy = false;
      response
        .writeHead(400)
        .end(
          error instanceof Error
            ? error.message
            : 'Não foi possível conectar o Spotify.',
        );
    }
  });
  const timeout = setTimeout(() => {
    console.log('Tempo de autorização encerrado. Execute o comando novamente.');
    server.close();
    process.exitCode = 1;
  }, 300000);
  server.on('error', () => {
    clearTimeout(timeout);
    console.error(
      'Não consegui abrir o callback local. Confira a porta e tente novamente.',
    );
    process.exitCode = 1;
  });
  server.listen(Number(authorization.redirect.port || 80), '127.0.0.1', () => {
    console.log(
      'Cadastre este Redirect URI no Spotify Developer Dashboard: ' +
        authorization.redirect.href,
    );
    console.log(
      'Abra no navegador e autorize a conta compartilhada com o grupo:\n' +
        authorization.url,
    );
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Não foi possível conectar o Spotify.',
    );
    process.exitCode = 1;
  });
}
