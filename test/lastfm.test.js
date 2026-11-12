import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LastFmClient, LastFmError, signLastFm } from '../src/lastfm/client.ts';
import { LastFmRepository } from '../src/lastfm/repository.ts';
import { LastFmService } from '../src/lastfm/service.ts';
import { LastFmScrobbler } from '../src/lastfm/scrobbler.ts';
import { lastFmMetadata } from '../src/lastfm/metadata.ts';
import { handleLastFmInteraction } from '../src/lastfm/interactions.ts';
import { panelPayload } from '../src/music/presentation.ts';
const item = {
  artist: 'Queen',
  track: 'Somebody to Love',
  duration: 100,
  timestamp: 100,
  chosenByUser: '0',
};
function setup(t, request = async () => ({})) {
  const repository = new LastFmRepository(':memory:', 'private-test-secret');
  const client = {
    request,
    authorizationUrl: (token) => 'https://www.last.fm/api/auth/?token=' + token,
  };
  const service = new LastFmService(client, repository);
  t.after(() => {
    service.close();
    repository.close();
  });
  return { repository, service };
}
test('Last.fm assina parâmetros em ordem sem format/callback e não expõe credenciais na URL', async () => {
  const params = {
    track: 'Música',
    artist: 'Artista',
    format: 'json',
    callback: 'ignore',
  };
  assert.equal(
    signLastFm(params, 'secret'),
    createHash('md5').update('artistArtistatrackMúsicasecret').digest('hex'),
  );
  let request;
  const client = new LastFmClient(
    'private-key',
    'private-secret',
    async (url, options) => {
      request = { url, options, body: new URLSearchParams(options.body) };
      return {
        ok: true,
        json: async () => ({ scrobbles: { '@attr': { accepted: '1' } } }),
      };
    },
  );
  await client.request(
    'track.scrobble',
    { sk: 'private-session', artist: 'Queen', track: 'Song', timestamp: '10' },
    true,
  );
  assert.equal(request.url, 'https://ws.audioscrobbler.com/2.0/');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.body.get('sk'), 'private-session');
  assert.ok(request.body.get('api_sig'));
  assert.ok(!String(request.options.body).includes('private-secret'));
});
test('Last.fm trata erro da API mesmo em HTTP 200 sem revelar resposta sensível', async () => {
  const client = new LastFmClient('key', 'secret', async () => ({
    ok: true,
    json: async () => ({ error: 9, message: 'leaked-private-session' }),
  }));
  await assert.rejects(
    client.request('track.scrobble'),
    (error) =>
      error instanceof LastFmError &&
      error.code === 9 &&
      !error.message.includes('leaked'),
  );
});
test('sessões Last.fm são criptografadas, persistem e desconectar apaga registros pendentes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'thedam-lastfm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'lastfm.sqlite');
  const repository = new LastFmRepository(path, 'secret');
  repository.save('ana', 'Ana', 'session-private-value');
  assert.equal(repository.enqueue('play:ana', 'ana', item), true);
  assert.equal(repository.enqueue('play:ana', 'ana', item), false);
  repository.close();
  const database = new DatabaseSync(path);
  assert.ok(
    !database
      .prepare('SELECT session FROM accounts')
      .get()
      .session.includes('session-private-value'),
  );
  database.close();
  const reopened = new LastFmRepository(path, 'secret');
  assert.equal(reopened.account('ana').session, 'session-private-value');
  assert.equal(reopened.due().length, 1);
  reopened.remove('ana');
  assert.equal(reopened.account('ana'), undefined);
  assert.equal(reopened.due().length, 0);
  reopened.close();
});
test('autorização pessoal exige token vinculado ao usuário e confirmação; cancelar invalida o fluxo', async (t) => {
  const { service, repository } = setup(t, async (method) =>
    method === 'auth.getToken'
      ? { token: 'token' }
      : { session: { name: 'Ana', key: 'session' } },
  );
  const auth = await service.connect('ana');
  assert.equal(repository.account('ana'), undefined);
  await assert.rejects(service.confirm('bia', auth.id), /expirou/);
  assert.equal(await service.confirm('ana', auth.id), 'Ana');
  await assert.rejects(service.confirm('ana', auth.id), /expirou/);
  const cancelled = await service.connect('ana');
  service.cancelConnect('ana');
  await assert.rejects(service.confirm('ana', cancelled.id), /expirou/);
  assert.equal(repository.account('ana').name, 'Ana');
});
test('confirmação em andamento não reconecta conta depois de desconectar', async (t) => {
  let resolve;
  const { service, repository } = setup(t, async (method) =>
    method === 'auth.getToken'
      ? { token: 'token' }
      : new Promise((done) => (resolve = done)),
  );
  const auth = await service.connect('ana');
  const pending = service.confirm('ana', auth.id);
  service.unlink('ana');
  resolve({ session: { name: 'Ana', key: 'session' } });
  await assert.rejects(pending, /cancelada/);
  assert.equal(repository.account('ana'), undefined);
});
test('recomendações usam cache, tokens pessoais e artistas similares', async (t) => {
  let calls = 0;
  const { service } = setup(t, async (method) => {
    calls++;
    if (method === 'artist.getSimilar')
      return { similarartists: { artist: [{ name: 'David Bowie' }] } };
    if (method === 'artist.getTopTracks')
      return { toptracks: { track: [{ name: 'Heroes' }] } };
    return {
      similartracks: { track: [{ name: 'Heroes', artist: { name: 'David Bowie' } }] },
    };
  });
  const track = {
    provider: 'youtube',
    title: 'Queen — Somebody to Love',
    duration: 100,
  };
  const choices = await service.recommendations('ana', track);
  await service.recommendations('ana', track);
  assert.equal(calls, 1);
  assert.deepEqual(service.choice('ana', choices[0].token), {
    artist: 'David Bowie',
    track: 'Heroes',
  });
  assert.throws(() => service.choice('bia', choices[0].token), /expirada/);
  const artists = await service.recommendations('ana', track, true);
  assert.equal(artists[0].track, 'Heroes');
  assert.equal(calls, 3);
});
test('scrobble conta apenas tempo em Playing com usuário presente e não ensurdecido', (t) => {
  const { service, repository } = setup(t);
  repository.save('ana', 'Ana', 's1');
  repository.save('bia', 'Bia', 's2');
  const submitted = [],
    nowPlaying = [];
  service.flush = async () => {};
  service.nowPlaying = async (user) => {
    nowPlaying.push(user);
  };
  const original = repository.enqueue.bind(repository);
  repository.enqueue = (...args) => {
    submitted.push(args);
    return original(...args);
  };
  const tracker = new LastFmScrobbler(service);
  t.after(() => tracker.close());
  const state = {
    playbackId: 'play1',
    playbackActive: true,
    channelId: 'call',
    current: { provider: 'youtube', title: 'Queen — Song', duration: 100 },
    queue: [],
    paused: false,
    error: null,
    repeat: false,
  };
  const update = (at, changes = {}, audience = ['ana']) =>
    tracker.update({ ...state, ...changes }, new Set(audience), at);
  update(0);
  update(10000);
  update(20000, { paused: true });
  update(30000, { paused: true });
  update(40000);
  update(50000);
  update(60000, {}, []);
  update(70000, {}, ['ana', 'bia']);
  assert.equal(submitted.length, 0);
  update(80000, {}, ['ana', 'bia']);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0][1], 'ana');
  update(90000);
  update(100000);
  assert.equal(submitted.length, 1);
  assert.deepEqual(nowPlaying, ['ana', 'bia']);
  update(110000, { playbackId: 'play2' });
  update(120000, { playbackId: 'play2' });
  assert.equal(submitted.length, 1);
});
test('tempo antes do consentimento e após revogação não vira scrobble', (t) => {
  const { service, repository } = setup(t);
  service.flush = async () => {};
  service.nowPlaying = async () => {};
  const tracker = new LastFmScrobbler(service);
  t.after(() => tracker.close());
  const state = {
    playbackId: 'play',
    playbackActive: true,
    current: { provider: 'youtube', title: 'Queen — Song', duration: 40 },
  };
  tracker.update(state, new Set(['ana']), 0);
  repository.save('ana', 'Ana', 's');
  tracker.update(state, new Set(['ana']), 20000);
  assert.equal(repository.due().length, 0);
  tracker.update(state, new Set(['ana']), 30000);
  service.unlink('ana');
  tracker.update(state, new Set(['ana']), 50000);
  assert.equal(repository.due().length, 0);
});
test('faixas curtas e uploader sem artista identificável não geram metadados inventados', () => {
  assert.equal(lastFmMetadata({ title: 'Funny video', artist: 'Uploader' }), null);
  assert.deepEqual(
    lastFmMetadata({
      title: 'Video',
      requestedTitle: 'Song',
      requestedArtist: 'Queen',
      duration: 60,
    }),
    { artist: 'Queen', track: 'Song', duration: 60 },
  );
});
test('falha transitória fica pendente e sessão revogada é removida', async (t) => {
  let fail = true;
  const { service, repository } = setup(t, async () => {
    if (fail) throw new LastFmError(11);
    return { scrobbles: { '@attr': { accepted: '1' } } };
  });
  repository.save('ana', 'Ana', 's');
  repository.enqueue('one', 'ana', item);
  await service.flush();
  assert.equal(repository.due().length, 0);
  assert.equal(repository.due(Date.now() + 180000).length, 1);
  fail = false;
  repository.retry('one', 0, Date.now() - 60001);
  await service.flush();
  assert.equal(repository.due(Date.now() + 999999).length, 0);
});
test('erro de sessão Last.fm desliga vínculo e elimina a fila pessoal', async (t) => {
  const { service, repository } = setup(t, async () => {
    throw new LastFmError(9);
  });
  repository.save('ana', 'Ana', 's');
  repository.enqueue('one', 'ana', item);
  await service.flush();
  assert.equal(repository.account('ana'), undefined);
  assert.equal(repository.due().length, 0);
});
test('Last.fm aparece só quando configurado e não excede cinco linhas do painel', () => {
  const state = { current: null, queue: [] };
  const off = panelPayload(state, [], false, false);
  const on = panelPayload(state, [], true, true);
  assert.ok(!JSON.stringify(off).includes('lastfm'));
  assert.ok(JSON.stringify(on).includes('lastfm'));
  assert.ok(on.components.length <= 5);
});
test('sugestão do Last.fm reutiliza busca e seleção de versões; nunca toca sem autorização musical', async (t) => {
  const { service } = setup(t, async () => ({
    similartracks: { track: [{ name: 'Song', artist: { name: 'Artist' } }] },
  }));
  const [suggestion] = await service.recommendations('ana', { title: 'Queen — Song' });
  let payload, called;
  const interaction = {
    user: { id: 'ana' },
    guildId: 'guild',
    isButton: () => false,
    isStringSelectMenu: () => true,
    editReply: async (value) => {
      payload = value;
    },
  };
  await handleLastFmInteraction(
    interaction,
    'lastfmTrack',
    suggestion.token,
    {
      gateway: { member: async () => {} },
      run: async (...args) => {
        called = args;
        return { tracks: [{ title: 'Version', token: 'authorized-result' }] };
      },
    },
    service,
  );
  assert.equal(called[2], 'search');
  assert.equal(called[3].query, 'Artist Song');
  assert.equal(payload.components[0].components[0].custom_id, 'dam:track');
});
