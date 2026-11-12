import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioLocationCache,
  trustedAudioLocation,
} from '../src/music/audio-location-cache.ts';
import { Catalog } from '../src/music/catalog.ts';
const id = 'abcdefghijk';
const location = {
  url: 'https://r1.googlevideo.com/videoplayback?expire=9999999999&token=private-example',
  headers: { 'User-Agent': 'Browser' },
};
test('link direto resolve metadados e fonte uma única vez sem expor a URL em resultados', async () => {
  let calls = 0;
  const catalog = new Catalog(
    { ytdlp: 'yt-dlp' },
    {
      extract: async () => {
        calls++;
        return {
          id,
          title: 'Música',
          url: location.url,
          http_headers: location.headers,
        };
      },
    },
  );
  const tracks = await catalog.search('https://youtu.be/' + id);
  const first = await catalog.audioLocation(tracks[0]);
  first.headers['User-Agent'] = 'Alterado';
  assert.equal(
    (await catalog.audioLocation(tracks[0])).headers['User-Agent'],
    'Browser',
  );
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(tracks).includes('private-example'));
  catalog.invalidateAudio(id);
  await catalog.audioLocation(tracks[0]);
  assert.equal(calls, 2);
});
test('cache respeita o prazo curto e a expiração da própria URL', () => {
  let now = 1000000;
  const cache = new AudioLocationCache(() => now);
  cache.set(id, location);
  now += 90001;
  assert.equal(cache.get(id), null);
  cache.set(id, {
    ...location,
    url: 'https://r1.googlevideo.com/audio?expire=' + Math.floor((now + 20000) / 1000),
  });
  assert.equal(cache.get(id), null);
});
test('fonte aceita somente CDN HTTPS esperada e ignora cabeçalhos inesperados', () => {
  for (const url of [
    'http://r1.googlevideo.com/audio',
    'https://googlevideo.com.evil.test/audio',
    'https://127.0.0.1/audio',
    'https://user:password@r1.googlevideo.com/audio',
  ])
    assert.equal(trustedAudioLocation(url), null);
  const safe = trustedAudioLocation(location.url, {
    'User-Agent': 'Browser',
    Cookie: 'never-send',
    Referer: 'invalid\r\nInjected: value',
  });
  assert.deepEqual(safe.headers, { 'User-Agent': 'Browser' });
});
