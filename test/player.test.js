import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerService } from '../src/music/player-service.ts';
import { parseQuery } from '../src/music/catalog.ts';
const guild = '200000000000000001',
  user = '100000000000000001';
function fixture() {
  let channel = '300000000000000001';
  let idle, fail;
  let stopped = 0,
    destroyed = 0,
    played = 0;
  const gateway = {
    authorize: async () => channel,
    connect: async () => ({
      onIdle: (fn) => (idle = fn),
      onError: (fn) => (fail = fn),
      onDisconnect() {},
      play() {
        played++;
      },
      stop() {},
      pause() {},
      resume() {},
      destroy() {
        destroyed++;
      },
    }),
  };
  const catalog = {
    search: async () => [{ provider: 'youtube', id: 'abcdefghijk', title: 'Música' }],
    playable: async (t) => t,
  };
  const service = new PlayerService({
    allowedGuildId: guild,
    gateway,
    catalog,
    source: () => ({
      stream: {},
      stop() {
        stopped++;
      },
    }),
  });
  return {
    service,
    gateway,
    catalog,
    setChannel: (c) => (channel = c),
    idle: () => idle(),
    fail: () => fail(),
    get stopped() {
      return stopped;
    },
    get destroyed() {
      return destroyed;
    },
    get played() {
      return played;
    },
  };
}
async function add(f) {
  const result = await f.service.run(guild, user, 'search', { query: 'música' });
  return f.service.run(guild, user, 'enqueue', { token: result.tracks[0].token });
}
test('busca, fila, pausa, próxima e parada liberam todos os recursos', async () => {
  const f = fixture();
  await add(f);
  assert.equal(f.played, 1);
  await add(f);
  assert.equal(f.service.state(guild).queue.length, 1);
  await f.service.run(guild, user, 'pause');
  assert.equal(f.service.state(guild).paused, true);
  await f.service.run(guild, user, 'resume');
  assert.equal(f.service.state(guild).paused, false);
  await f.service.run(guild, user, 'skip');
  assert.equal(f.played, 2);
  assert.equal(f.stopped, 1);
  await f.service.run(guild, user, 'stop');
  assert.equal(f.destroyed, 1);
  assert.equal(f.stopped, 2);
  assert.equal(f.service.state(guild).current, null);
});
test('outra call não pode assumir fila e resultado não pode ser forjado ou reutilizado', async () => {
  const f = fixture();
  const result = await f.service.run(guild, user, 'search', { query: 'x' });
  const token = result.tracks[0].token;
  await assert.rejects(
    f.service.run(guild, '100000000000000002', 'enqueue', { token }),
    (e) => e.status === 410,
  );
  await f.service.run(guild, user, 'enqueue', { token });
  await assert.rejects(
    f.service.run(guild, user, 'enqueue', { token }),
    (e) => e.status === 410,
  );
  f.setChannel('400000000000000001');
  await assert.rejects(f.service.run(guild, user, 'stop'), (e) => e.status === 409);
  f.service.close();
});
test('mudança de call durante busca de fonte impede a reprodução', async () => {
  const f = fixture();
  f.catalog.playable = async (t) => {
    f.setChannel('400000000000000001');
    return t;
  };
  await assert.rejects(add(f), (e) => e.status === 409);
  assert.equal(f.played, 0);
  f.service.close();
});
test('fim natural consome a fila e destrói a conexão quando termina', async () => {
  const f = fixture();
  await add(f);
  await add(f);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.played, 2);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.destroyed, 1);
  f.service.close();
});
test('links só aceitam vídeos/tracks das plataformas suportadas', () => {
  assert.equal(parseQuery('https://youtu.be/abcdefghijk').video, 'abcdefghijk');
  assert.equal(
    parseQuery('https://open.spotify.com/track/1234567890123456789012').provider,
    'spotify',
  );
  for (const url of [
    'http://127.0.0.1/admin',
    'https://example.com/a.mp3',
    'https://youtube.com.evil.test/watch?v=abcdefghijk',
    'https://user:pass@youtube.com/watch?v=abcdefghijk',
  ])
    assert.throws(
      () => parseQuery(url),
      (e) => e.status === 400,
    );
});

test('parar não espera busca lenta e o resultado pendente é invalidado', async () => {
  const f = fixture();
  let release;
  f.catalog.search = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const search = f.service.run(guild, user, 'search', { query: 'x' });
  await new Promise(setImmediate);
  await f.service.run(guild, user, 'stop');
  release([{ provider: 'youtube', id: 'abcdefghijk', title: 'Teste' }]);
  await assert.rejects(search, /cancelado/);
  assert.equal(f.played, 0);
  f.service.close();
});
test('fila remove por identidade estável e repetir não impede pular', async () => {
  const f = fixture();
  await add(f);
  await add(f);
  await add(f);
  let state = f.service.state(guild);
  await f.service.run(guild, user, 'remove', { id: state.queue[0].queueId });
  assert.equal(f.service.state(guild).queue.length, 1);
  await f.service.run(guild, user, 'repeat', { enabled: true });
  await f.service.run(guild, user, 'skip');
  assert.equal(f.played, 2);
  assert.equal(f.service.state(guild).repeat, false);
  await assert.rejects(
    f.service.run(guild, user, 'remove', { id: 'stale' }),
    /não está mais/,
  );
  f.service.close();
});
test('biblioteca compartilha playlists e histórico, mantém favoritos pessoais e toca a lista', async () => {
  const { LibraryRepository } = await import('../src/music/library-repository.ts');
  const f = fixture();
  const db = new LibraryRepository(':memory:');
  f.service.library = db;
  await add(f);
  await add(f);
  const saved = await f.service.run(guild, user, 'savePlaylist', {
    name: 'Rock',
    category: 'Gênero',
  });
  assert.equal(saved.playlist.tracks.length, 2);
  await f.service.run(guild, user, 'favorite');
  assert.equal((await f.service.run(guild, user, 'favorites')).favorites.length, 1);
  assert.equal((await f.service.run(guild, user, 'history')).history.length, 1);
  await f.service.run(guild, user, 'playlistEnqueue', { id: saved.playlist.id });
  assert.equal(f.service.state(guild).queue.length, 3);
  await f.service.run(guild, user, 'deduplicate');
  assert.equal(f.service.state(guild).queue.length, 0);
  f.service.close();
  db.close();
});
