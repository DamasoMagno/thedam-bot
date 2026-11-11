import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityTimer } from '../src/chat/activity-timer.ts';
function fixture(random = () => 0, speak) {
  let time = 0,
    enabled = true;
  const sent = [],
    scheduled = [],
    canceled = [];
  let timer;
  timer = createActivityTimer({
    now: () => time,
    random,
    enabled: () => enabled,
    speak: async (channel) => {
      sent.push(channel);
      timer.noteReply();
      await speak?.();
    },
    schedule: (callback, delay) => {
      const id = { callback, delay, unref() {} };
      scheduled.push(id);
      return id;
    },
    cancel: (id) => canceled.push(id),
  });
  return {
    timer,
    sent,
    scheduled,
    canceled,
    setTime: (value) => (time = value),
    disable: () => (enabled = false),
    activity: (count = 6) => {
      for (let i = 0; i < count; i++)
        timer.noteActivity('geral', i % 2 ? 'ana' : 'bia');
    },
  };
}
test('conversa precisa estar movimentada e só uma resposta fica agendada', async () => {
  const f = fixture();
  f.activity(5);
  assert.equal(f.scheduled.length, 0);
  f.timer.noteActivity('geral', 'bia');
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].delay, 120000);
  f.activity(20);
  assert.equal(f.scheduled.length, 1);
  f.setTime(119000);
  f.timer.noteActivity('geral', 'ana');
  f.setTime(120000);
  await f.timer.tick();
  assert.deepEqual(f.sent, ['geral']);
  f.timer.close();
});
test('espera varia e silêncio cancela a resposta sem falar sozinho', async () => {
  const f = fixture(() => 1);
  f.activity();
  assert.equal(f.scheduled[0].delay, 300000);
  f.setTime(300000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  f.timer.close();
});
test('um único usuário não ativa espontaneidade e desligar cancela o envio', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.timer.noteActivity('geral', 'ana');
  assert.equal(f.scheduled.length, 0);
  f.activity();
  f.disable();
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  f.timer.close();
});
test('responder por menção cancela resposta pendente e respeita intervalo mínimo', async () => {
  const f = fixture();
  f.activity();
  f.timer.noteReply();
  assert.equal(f.canceled.length, 1);
  f.setTime(60000);
  f.activity();
  assert.equal(f.scheduled.length, 1);
  f.setTime(120000);
  f.activity();
  assert.equal(f.scheduled.length, 2);
  f.timer.close();
  f.setTime(240000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
});
