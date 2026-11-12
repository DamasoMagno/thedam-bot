import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../src/music/catalog.ts';
import { SearchCache } from '../src/music/search-cache.ts';
const track = { id: 'abcdefghijk', title: 'Música', provider: 'youtube' };

test('busca recente reaproveita metadados sem compartilhar objetos ou tokens de usuário', async () => {
  let calls = 0;
  const catalog = new Catalog(
    { ytdlp: 'yt-dlp' },
    {
      extract: async () => {
        calls++;
        return { entries: [track] };
      },
    },
  );
  const first = await catalog.search('Queen Bohemian');
  first[0].title = 'Alterada';
  const second = await catalog.search('queen   bohemian');
  assert.equal(calls, 1);
  assert.equal(second[0].title, 'Música');
  assert.equal(catalog.searchStatus().hits, 1);
  assert.equal(catalog.searchStatus().misses, 1);
  assert.equal(second[0].token, undefined);
});
test('cache expira, tem limite e uma busca cancelada não fica salva', async () => {
  let now = 0;
  const cache = new SearchCache(10, 2, () => now);
  cache.set('a', [track]);
  cache.set('b', [track]);
  cache.get('a');
  cache.set('c', [track]);
  assert.equal(cache.get('b'), null);
  assert.ok(cache.get('a'));
  now = 11;
  assert.equal(cache.get('a'), null);
  const controller = new AbortController();
  const catalog = new Catalog(
    { ytdlp: 'yt-dlp' },
    {
      cache,
      extract: async () => {
        controller.abort();
        return { entries: [track] };
      },
    },
  );
  await assert.rejects(
    catalog.search('Queen', 'youtube', { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(catalog.searchStatus().entries, 1);
  const aborted = AbortSignal.abort();
  await assert.rejects(catalog.search('Queen', 'youtube', { signal: aborted }), {
    name: 'AbortError',
  });
});
test('falhas e resultados vazios não envenenam o cache', async () => {
  let calls = 0;
  const catalog = new Catalog(
    { ytdlp: 'yt-dlp' },
    {
      extract: async () => {
        calls++;
        if (calls === 1) throw new Error('rede');
        return calls === 2 ? { entries: [] } : { entries: [track] };
      },
    },
  );
  await assert.rejects(catalog.search('teste'), /rede/);
  assert.deepEqual(await catalog.search('teste'), []);
  assert.equal((await catalog.search('teste'))[0].id, track.id);
  assert.equal(calls, 3);
});
