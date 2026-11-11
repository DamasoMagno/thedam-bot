import test from 'node:test';
import assert from 'node:assert/strict';
import { createMentionQueue } from '../src/chat/mention-queue.ts';
test('pessoas diferentes não se bloqueiam e a mesma pessoa mantém só um pedido pendente', async () => {
  let time = 0;
  const sent = [],
    timers = [];
  const queue = createMentionQueue({
    now: () => time,
    respond: async (message) => sent.push(message.id),
    schedule: (callback, delay) => {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    cancel: () => {},
  });
  queue.enqueue({ id: 'one', author: { id: 'ana' } });
  await new Promise(setImmediate);
  queue.enqueue({ id: 'two', author: { id: 'bia' } });
  queue.enqueue({ id: 'three', author: { id: 'bia' } });
  assert.deepEqual(sent, ['one']);
  assert.equal(timers[0].delay, 1000);
  time = 1000;
  await queue.drain();
  assert.deepEqual(sent, ['one', 'three']);
  queue.close();
});

test('espera um segundo depois da resposta, mesmo se a primeira demorar', async () => {
  let time = 0,
    release;
  const timers = [];
  let calls = 0;
  const queue = createMentionQueue({
    now: () => time,
    respond: async () => {
      calls++;
      if (calls === 1)
        await new Promise((resolve) => {
          release = resolve;
        });
    },
    schedule: (_callback, delay) => {
      timers.push(delay);
      return { unref() {} };
    },
    cancel: () => {},
  });
  queue.enqueue({ id: 'a', author: { id: 'ana' } });
  queue.enqueue({ id: 'b', author: { id: 'bia' } });
  time = 5000;
  release();
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(timers[0], 1000);
  queue.close();
});
