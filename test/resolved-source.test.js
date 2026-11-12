import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createResolvedSource } from '../src/music/resolved-source.ts';
const spotify = { provider: 'spotify', id: '1'.repeat(22), title: 'Música' };
const youtube = { provider: 'youtube', id: 'abcdefghijk', title: 'Música' };
test('resolve só a faixa solicitada e encaminha áudio quando estiver pronta', async () => {
  const input = new PassThrough();
  const received = [];
  let called = 0,
    paused = 0;
  const source = createResolvedSource(
    spotify,
    {
      playable: async () => {
        called++;
        return youtube;
      },
    },
    (track) => {
      assert.equal(track.id, youtube.id);
      return {
        stream: input,
        stop() {
          input.destroy();
        },
        pause() {
          paused++;
        },
      };
    },
    assert.fail,
  );
  source.stream.on('data', (chunk) => received.push(chunk.toString()));
  source.pause();
  await new Promise(setImmediate);
  assert.equal(called, 1);
  assert.equal(paused, 1);
  const end = once(source.stream, 'end');
  input.end('PCM');
  await end;
  assert.equal(received.join(''), 'PCM');
  source.stop();
});
test('pular/parar durante resolução cancela consulta e impede iniciar áudio atrasado', async () => {
  let finish,
    signal,
    spawned = 0;
  const source = createResolvedSource(
    spotify,
    {
      playable: async (_track, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    () => {
      spawned++;
    },
    assert.fail,
  );
  source.stop();
  finish(youtube);
  await new Promise(setImmediate);
  assert.equal(signal.aborted, true);
  assert.equal(spawned, 0);
});
