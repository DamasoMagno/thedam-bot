import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { prepareAudioSource } from '../src/music/prepared-source.ts';
const track = { provider: 'youtube', id: 'abcdefghijk', title: 'Música' };
test('preparo guarda os primeiros bytes e transfere a mesma fonte sem reiniciar', async () => {
  const input = new PassThrough();
  let created = 0,
    stopped = 0;
  const prepared = prepareAudioSource(track, () => {
    created++;
    return {
      stream: input,
      stop() {
        stopped++;
        input.destroy();
      },
    };
  });
  let ready = false;
  void prepared.ready.then(() => {
    ready = true;
  });
  await new Promise(setImmediate);
  assert.equal(ready, false);
  input.write('PCM');
  await prepared.ready;
  const source = prepared.take(
    assert.fail,
    () => {},
    () => {},
  );
  prepared.stop();
  assert.equal(source.stream.destroyed, false);
  const chunks = [];
  source.stream.on('data', (chunk) => chunks.push(chunk.toString()));
  const end = once(source.stream, 'end');
  input.end('tail');
  await end;
  assert.equal(chunks.join(''), 'PCMtail');
  assert.equal(created, 1);
  source.stop();
  assert.equal(stopped, 1);
});
test('cancelar preparação interrompe a fonte antes da conexão ficar pronta', async () => {
  const controller = new AbortController(),
    input = new PassThrough();
  let stopped = 0;
  const prepared = prepareAudioSource(
    track,
    () => ({
      stream: input,
      stop() {
        stopped++;
        input.destroy();
      },
    }),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(prepared.ready, { name: 'AbortError' });
  assert.equal(stopped, 1);
  assert.ok(input.destroyed);
  assert.throws(
    () =>
      prepared.take(
        assert.fail,
        () => {},
        () => {},
      ),
    /disponível/,
  );
});
