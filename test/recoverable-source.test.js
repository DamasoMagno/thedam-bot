import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createRecoverableSource } from '../src/music/recoverable-source.ts';
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
function fixture() {
  const attempts = [],
    received = [];
  let failures = 0,
    retries = 0,
    recovered = 0;
  const source = createRecoverableSource(
    { id: 'abcdefghijk', title: 'Música', provider: 'youtube' },
    (_track, fail) => {
      const stream = new PassThrough();
      const attempt = { stream, fail, stopped: 0, paused: 0 };
      attempts.push(attempt);
      return {
        stream,
        stop() {
          attempt.stopped++;
          stream.destroy();
        },
        pause() {
          attempt.paused++;
        },
        resume() {},
      };
    },
    () => failures++,
    () => retries++,
    () => recovered++,
  );
  source.stream.on('data', (chunk) => received.push(chunk.toString()));
  return {
    source,
    attempts,
    received,
    get failures() {
      return failures;
    },
    get retries() {
      return retries;
    },
    get recovered() {
      return recovered;
    },
  };
}
test('fonte falha uma vez, libera processos antigos e continua na mesma stream', async () => {
  const f = fixture();
  f.attempts[0].stream.write('primeiro');
  f.attempts[0].fail(new Error('rede'));
  await flush();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.attempts[0].stopped, 1);
  assert.equal(f.failures, 0);
  assert.equal(f.retries, 1);
  const end = once(f.source.stream, 'end');
  f.attempts[1].stream.end('segundo');
  await end;
  assert.equal(f.received.join(''), 'primeirosegundo');
  assert.equal(f.recovered, 1);
  f.source.stop();
});
test('segunda falha desiste uma vez e callbacks antigos não avançam novamente', async () => {
  const f = fixture();
  f.attempts[0].fail();
  await flush();
  f.attempts[0].fail();
  f.attempts[1].fail();
  f.attempts[1].fail();
  await flush();
  assert.equal(f.attempts.length, 2);
  assert.equal(f.failures, 1);
  assert.ok(f.source.stream.destroyed);
});
test('parar cancela recuperação pendente e pausa é preservada na nova fonte', async () => {
  const stopped = fixture();
  stopped.attempts[0].fail();
  await Promise.resolve();
  stopped.source.stop();
  await flush();
  assert.equal(stopped.attempts.length, 1);
  assert.equal(stopped.failures, 0);
  const paused = fixture();
  paused.source.pause();
  paused.attempts[0].fail();
  await flush();
  assert.equal(paused.attempts[1].paused, 1);
  paused.source.stop();
});

test('uma fonte vazia é tratada como falha e tem só uma recuperação', async () => {
  const f = fixture();
  f.attempts[0].stream.end();
  await flush();
  assert.equal(f.attempts.length, 2);
  f.attempts[1].stream.end();
  await flush();
  assert.equal(f.failures, 1);
});
