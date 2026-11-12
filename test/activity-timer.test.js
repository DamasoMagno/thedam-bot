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
    setTime: (value) => {
      time = value;
    },
    disable: () => {
      enabled = false;
    },
  };
}
test('automático inicia sem pessoas nem mensagens e continua mesmo no silêncio', async () => {
  const f = fixture();
  f.timer.start('geral');
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].delay, 120000);
  f.setTime(120000);
  await f.timer.tick();
  assert.deepEqual(f.sent, ['geral']);
  assert.equal(f.scheduled.length, 2);
  f.setTime(240000);
  await f.timer.tick();
  assert.equal(f.sent.length, 2);
  f.timer.close();
});
test('uma única pessoa pode iniciar e muitas mensagens não duplicam o agendamento', async () => {
  const f = fixture(() => 1);
  f.timer.noteActivity('geral', 'ana');
  for (let i = 0; i < 100; i++) f.timer.noteActivity('geral', 'ana');
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].delay, 300000);
  f.setTime(300000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
});
test('desligar cancela a participação e não agenda novos envios', async () => {
  const f = fixture();
  f.timer.start('geral');
  f.disable();
  f.timer.reset();
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.scheduled.length, 1);
  f.timer.close();
});
test('menções reiniciam a espera e encerramento impede novos envios', async () => {
  const f = fixture();
  f.timer.start('geral');
  f.setTime(60000);
  f.timer.noteReply();
  assert.equal(f.canceled.length, 1);
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  f.setTime(180000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
  f.setTime(300000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
});
test('falha de envio aguarda um novo intervalo e não fica em loop', async () => {
  const f = fixture(
    () => 0,
    async () => {
      throw new Error('rede');
    },
  );
  f.timer.start('geral');
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.scheduled.length, 2);
  assert.equal(f.scheduled[1].delay, 120000);
  f.timer.close();
});

test('desligar enquanto gera resposta invalida o envio em andamento', async () => {
  let now = 0,
    enabled = true,
    finish;
  let sent = 0;
  const timer = createActivityTimer({
    now: () => now,
    random: () => 0,
    enabled: () => enabled,
    schedule: () => ({ unref() {} }),
    cancel: () => {},
    speak: async (_channel, isCurrent) => {
      await new Promise((resolve) => {
        finish = resolve;
      });
      if (isCurrent()) sent++;
    },
  });
  timer.start('geral');
  now = 120000;
  const pending = timer.tick();
  enabled = false;
  timer.reset();
  finish();
  await pending;
  assert.equal(sent, 0);
  timer.close();
});
