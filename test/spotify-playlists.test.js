import test from 'node:test';
import assert from 'node:assert/strict';
import { SpotifyPlaylists, spotifyPlaylistId } from '../src/music/spotify-playlists.ts';
import {
  createSpotifyAuthorization,
  saveSpotifyAuthorization,
} from '../src/music/spotify-connect.ts';
const id = '1234567890123456789012';
const link = 'https://open.spotify.com/playlist/' + id;
const track = (n = 0) => ({
  id: String(n).padStart(22, '0'),
  name: 'Faixa ' + n,
  type: 'track',
  artists: [{ name: 'Artista' }],
  duration_ms: 60000,
});
const response = (data) => ({ ok: true, json: async () => data });
test('importação pagina pela API oficial, aceita campos novos e antigos e ignora itens inválidos', async () => {
  const requests = [];
  const importer = new SpotifyPlaylists(
    { id: 'client', secret: 'secret', refreshToken: 'private-refresh' },
    async (url) => {
      requests.push(url);
      if (url.includes('/api/token'))
        return response({ access_token: 'private-access', expires_in: 3600 });
      if (url.endsWith('/playlists/' + id)) return response({ name: 'Minha lista' });
      if (url.includes('offset=0'))
        return response({
          items: [
            { item: track(1) },
            { item: track(1) },
            { item: null },
            { is_local: true, item: track(2) },
          ],
          next: 'https://evil.example/never-follow',
        });
      return response({ items: [{ track: track(3) }], next: null });
    },
  );
  const result = await importer.import(link);
  assert.equal(result.name, 'Minha lista');
  assert.equal(result.tracks.length, 2);
  assert.equal(result.skipped, 3);
  assert.ok(requests.at(-1).startsWith('https://api.spotify.com/v1/playlists/'));
  assert.ok(requests.at(-1).includes('offset=4'));
});
test('playlists grandes são recusadas sem devolver importação parcial', async () => {
  const importer = new SpotifyPlaylists(
    { id: 'client', secret: 'secret', refreshToken: 'private' },
    async (url) => {
      if (url.includes('/api/token')) return response({ access_token: 'access' });
      if (url.endsWith('/playlists/' + id)) return response({ name: 'Grande' });
      return response(
        url.includes('offset=0')
          ? {
              items: Array.from({ length: 50 }, (_, i) => ({ item: track(i) })),
              next: 'page2',
            }
          : { items: [{ item: track(51) }], next: null },
      );
    },
  );
  await assert.rejects(importer.import(link), /mais de 50/);
});
test('importação exige conta conectada e informa restrição do Spotify sem contornar permissões', async () => {
  let calls = 0;
  const noAccount = new SpotifyPlaylists(
    { id: 'client', secret: 'secret' },
    async () => {
      calls++;
    },
  );
  await assert.rejects(noAccount.import(link), /spotify:connect/);
  assert.equal(calls, 0);
  const forbidden = new SpotifyPlaylists(
    { id: 'client', secret: 'secret', refreshToken: 'private' },
    async (url) =>
      url.includes('/api/token')
        ? response({ access_token: 'access' })
        : { ok: false, status: 403 },
  );
  await assert.rejects(forbidden.import(link), /propriet|conta conectada/);
  for (const url of [
    'https://open.spotify.com.evil.test/playlist/' + id,
    'http://127.0.0.1/admin',
    'https://user:pass@open.spotify.com/playlist/' + id,
  ])
    assert.equal(spotifyPlaylistId(url), null);
});
test('autorização local valida state, callback e uso único sem exibir credenciais', async () => {
  const calls = [];
  const auth = createSpotifyAuthorization({
    clientId: 'client',
    clientSecret: 'secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({ refresh_token: 'saved-private' });
    },
  });
  const state = new URL(auth.url).searchParams.get('state');
  await assert.rejects(
    auth.exchange(new URL('http://127.0.0.1:8890/callback?code=x&state=wrong')),
    /inválido/,
  );
  const callback = new URL('http://127.0.0.1:8890/callback?code=x&state=' + state);
  assert.equal(await auth.exchange(callback), 'saved-private');
  await assert.rejects(auth.exchange(callback), /já utilizado/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://accounts.spotify.com/api/token');
  assert.throws(
    () =>
      createSpotifyAuthorization({
        clientId: 'client',
        clientSecret: 'secret',
        redirectUri: 'http://evil.example/callback',
      }),
    /callback local/,
  );
});
test('autorização salva no env preserva outras variáveis e usa arquivo privado', async (t) => {
  const { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'thedam-spotify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, '.env');
  writeFileSync(path, 'DISCORD_BOT_TOKEN=keep\nSPOTIFY_REFRESH_TOKEN=old\n');
  saveSpotifyAuthorization(path, 'new-private');
  const contents = readFileSync(path, 'utf8');
  assert.ok(contents.includes('DISCORD_BOT_TOKEN=keep'));
  assert.ok(contents.includes('SPOTIFY_REFRESH_TOKEN="new-private"'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.throws(() => saveSpotifyAuthorization(path, 'invalid\nvalue'), /inválida/);
});
