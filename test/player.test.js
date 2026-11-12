import { PassThrough } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerService } from '../src/music/player-service.ts';
import { parseQuery } from '../src/music/catalog.ts';
const guild = '200000000000000001',
  user = '100000000000000001';
function fixture(options = {}) {
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
    ...options,
    allowedGuildId: guild,
    gateway,
    catalog,
    source:
      options.source ||
      (() => {
        const stream = new PassThrough();
        stream.write(Buffer.alloc(3840));
        return {
          stream,
          stop() {
            stopped++;
            stream.destroy();
          },
        };
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
function idleFixture() {
  const timers = [],
    cancelled = new Set();
  const f = fixture({
    schedule: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => cancelled.add(timer),
  });
  return {
    ...f,
    timers,
    cancelled,
    get destroyed() {
      return f.destroyed;
    },
    get played() {
      return f.played;
    },
  };
}
test('fim natural consome a fila e aguarda sessenta segundos para sair', async () => {
  const f = idleFixture();
  await add(f);
  await add(f);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.played, 2);
  assert.equal(f.timers.length, 0);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.destroyed, 0);
  assert.equal(f.service.state(guild).waitingToLeave, true);
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].delay, 60000);
  f.timers[0].callback();
  assert.equal(f.destroyed, 1);
  assert.equal(f.service.state(guild).channelId, null);
  f.service.close();
});
test('nova música cancela saída e callbacks antigos não encerram a reprodução', async () => {
  const f = idleFixture();
  await add(f);
  f.idle();
  await new Promise(setImmediate);
  const first = f.timers[0];
  await add(f);
  assert.ok(f.cancelled.has(first));
  assert.equal(f.service.state(guild).waitingToLeave, false);
  first.callback();
  assert.equal(f.destroyed, 0);
  assert.equal(f.played, 2);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.timers.length, 2);
  first.callback();
  assert.equal(f.destroyed, 0);
  f.timers[1].callback();
  assert.equal(f.destroyed, 1);
  f.service.close();
});
test('parar e fechar cancelam a espera, e timer antigo não afeta outra conexão', async () => {
  const f = idleFixture();
  await add(f);
  f.idle();
  await new Promise(setImmediate);
  const old = f.timers[0];
  await f.service.run(guild, user, 'stop');
  assert.equal(f.destroyed, 1);
  assert.ok(f.cancelled.has(old));
  await add(f);
  old.callback();
  assert.equal(f.destroyed, 1);
  f.idle();
  await new Promise(setImmediate);
  const pending = f.timers[1];
  f.service.close();
  assert.ok(f.cancelled.has(pending));
  pending.callback();
  assert.equal(f.destroyed, 2);
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

test('fila move por identidade estável, sem trocar a música atual e sem autorizar outra call', async () => {
  const f = fixture();
  await add(f);
  await add(f);
  await add(f);
  await add(f);
  const initial = f.service.state(guild);
  const id = initial.queue[2].queueId;
  await f.service.run(guild, user, 'move', { id, direction: 'up' });
  let state = f.service.state(guild);
  assert.equal(state.queue[1].queueId, id);
  assert.equal(state.current.queueId, initial.current.queueId);
  assert.equal(f.played, 1);
  await f.service.run(guild, user, 'move', { id, direction: 'down' });
  assert.equal(f.service.state(guild).queue[2].queueId, id);
  await assert.rejects(
    f.service.run(guild, user, 'move', { id: 'stale', direction: 'up' }),
    /não está mais/,
  );
  await assert.rejects(
    f.service.run(guild, user, 'move', { id, direction: 'other' }),
    /Subir ou Descer/,
  );
  f.setChannel('outra');
  await assert.rejects(
    f.service.run(guild, user, 'move', { id, direction: 'up' }),
    /outra call/,
  );
  f.service.close();
});

test('biblioteca cria e salva faixas sem call, sem tocar e com tokens pessoais de uso único', async () => {
  const { LibraryRepository } = await import('../src/music/library-repository.ts');
  const f = fixture();
  const db = new LibraryRepository(':memory:');
  f.service.library = db;
  f.gateway.member = async () => ({});
  f.gateway.authorize = async () => {
    throw new Error('Nenhuma call deve ser consultada');
  };
  const list = await f.service.run(guild, user, 'createPlaylist', {
    name: 'Salvas',
    category: '',
  });
  const search = await f.service.run(guild, user, 'playlistSearch', {
    id: list.playlist.id,
    query: 'Queen',
  });
  const token = search.tracks[0].token;
  const saved = await f.service.run(guild, user, 'playlistAddTrack', {
    id: list.playlist.id,
    token,
  });
  assert.equal(saved.playlist.tracks.length, 1);
  assert.equal(f.played, 0);
  assert.equal(f.service.state(guild).current, null);
  await assert.rejects(
    f.service.run(guild, user, 'playlistAddTrack', { id: list.playlist.id, token }),
    /expirou/,
  );
  await assert.rejects(
    f.service.run(guild, 'outra-pessoa', 'playlistSearch', {
      id: list.playlist.id,
      query: 'Queen',
    }),
    /criador/,
  );
  f.service.close();
  db.close();
});
test('importar Spotify não toca e falhas de capacidade não salvam metade da lista', async () => {
  const { LibraryRepository } = await import('../src/music/library-repository.ts');
  const f = fixture();
  const db = new LibraryRepository(':memory:');
  f.service.library = db;
  f.gateway.member = async () => ({});
  f.gateway.authorize = async () => {
    throw new Error('Não entrar na call');
  };
  f.catalog.importPlaylist = async () => ({
    name: 'Spotify',
    skipped: 0,
    tracks: Array.from({ length: 50 }, (_, i) => ({
      provider: 'spotify',
      id: String(i).padStart(22, '0'),
      title: 'Faixa ' + i,
    })),
  });
  const result = await f.service.run(guild, user, 'importPlaylist', {
    query: 'playlist',
  });
  assert.equal(result.playlist.tracks.length, 50);
  assert.equal(f.played, 0);
  f.catalog.importPlaylist = async () => ({
    name: 'Outra',
    skipped: 0,
    tracks: [{ provider: 'spotify', id: '9'.repeat(22), title: 'Nova' }],
  });
  await assert.rejects(
    f.service.run(guild, user, 'importPlaylist', {
      id: result.playlist.id,
      query: 'outra',
    }),
    /50/,
  );
  assert.equal(db.playlist(guild, result.playlist.id).tracks.length, 50);
  f.service.close();
  db.close();
});

test('uma playlist Spotify prepara apenas a primeira faixa antes de iniciar', async () => {
  const { LibraryRepository } = await import('../src/music/library-repository.ts');
  const f = fixture();
  const db = new LibraryRepository(':memory:');
  f.service.library = db;
  const tracks = Array.from({ length: 4 }, (_, i) => ({
    provider: 'spotify',
    id: String(i).padStart(22, '0'),
    title: 'Faixa ' + i,
  }));
  const list = db.createPlaylist(guild, user, 'Spotify', '', tracks);
  let prepared = 0;
  f.catalog.playable = async () => {
    prepared++;
    return { provider: 'youtube', id: 'abcdefghijk', title: 'Primeira' };
  };
  await f.service.run(guild, user, 'playlistEnqueue', { id: list.id });
  assert.equal(prepared, 1);
  assert.equal(f.played, 1);
  assert.equal(f.service.state(guild).queue.length, 3);
  assert.ok(
    f.service.rooms.get(guild).queue.every((track) => track.provider === 'spotify'),
  );
  f.service.close();
  db.close();
});

test('pedido de voz mantém a call apenas enquanto necessário e não inicia música sozinho', async () => {
  const f = idleFixture();
  const connect = f.gateway.connect;
  let detached = 0;
  f.gateway.connect = async () => ({
    ...(await connect()),
    listen: () => () => detached++,
  });
  const release = await f.service.listen(guild, user, () => {});
  assert.equal(f.played, 0);
  assert.equal(f.service.state(guild).voiceRequests, 1);
  await add(f);
  f.idle();
  await new Promise(setImmediate);
  assert.equal(f.service.state(guild).current, null);
  assert.equal(f.destroyed, 0);
  release();
  assert.equal(detached, 1);
  assert.equal(f.destroyed, 0);
  assert.equal(f.timers.at(-1).delay, 60000);
  f.timers.at(-1).callback();
  assert.equal(f.destroyed, 1);
  f.service.close();
});

test('áudio e conexão começam em paralelo, mas tocar aguarda ambos', async () => {
  const stream = new PassThrough();
  let audioStarted = false,
    connectionStarted = false,
    release;
  const f = fixture({
    source: () => {
      audioStarted = true;
      return {
        stream,
        stop() {
          stream.destroy();
        },
      };
    },
  });
  const original = f.gateway.connect;
  f.gateway.connect = async () => {
    connectionStarted = true;
    await new Promise((resolve) => {
      release = resolve;
    });
    return original();
  };
  const pending = add(f);
  await new Promise(setImmediate);
  assert.equal(audioStarted, true);
  assert.equal(connectionStarted, true);
  assert.equal(f.played, 0);
  stream.write(Buffer.alloc(3840));
  await new Promise(setImmediate);
  assert.equal(f.played, 0);
  release();
  await pending;
  assert.equal(f.played, 1);
  f.service.close();
});
test('parar durante preparo paralelo cancela o áudio e não retoma o pedido', async () => {
  const stream = new PassThrough();
  let stopped = 0;
  const f = fixture({
    source: () => ({
      stream,
      stop() {
        stopped++;
        stream.destroy();
      },
    }),
  });
  const pending = add(f);
  await new Promise(setImmediate);
  await f.service.run(guild, user, 'stop');
  await assert.rejects(pending, /cancelado/);
  assert.equal(stopped, 1);
  assert.equal(f.played, 0);
  assert.equal(f.destroyed, 1);
  f.service.close();
});
test('falha ao conectar libera a fonte que já estava sendo preparada', async () => {
  const stream = new PassThrough();
  let stopped = 0;
  const f = fixture({
    source: () => ({
      stream,
      stop() {
        stopped++;
        stream.destroy();
      },
    }),
  });
  f.gateway.connect = async () => {
    throw new Error('Falha de conexão');
  };
  await assert.rejects(add(f), /Falha de conexão/);
  assert.equal(stopped, 1);
  assert.equal(f.played, 0);
  assert.equal(f.service.rooms.size, 0);
  f.service.close();
});
