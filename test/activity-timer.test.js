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
test('iniciar o bot não agenda mensagem nem fala no silêncio', async () => {
  const f = fixture();
  f.timer.start('geral');
  assert.equal(f.scheduled.length, 0);
  f.setTime(3600000);
  await f.timer.tick();
  assert.deepEqual(f.sent, []);
  f.timer.close();
});
test('uma pessoa pode iniciar, mas cem mensagens geram no máximo uma resposta sem atividade nova', async () => {
  const f = fixture(() => 1);
  f.timer.noteActivity('geral', 'ana');
  for (let i = 0; i < 100; i++) f.timer.noteActivity('geral', 'ana');
  assert.equal(f.scheduled.length, 1);
  assert.equal(f.scheduled[0].delay, 300000);
  f.setTime(300000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.scheduled.length, 1);
  f.setTime(9999999);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
});
test('uma resposta automática só pode ser seguida de outra após mensagem humana nova', async () => {
  const f = fixture();
  f.timer.noteActivity('geral', 'ana');
  f.setTime(120000);
  await f.timer.tick();
  f.setTime(500000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.noteActivity('geral', 'bia');
  assert.equal(f.scheduled.length, 2);
  f.setTime(620000);
  await f.timer.tick();
  assert.equal(f.sent.length, 2);
  assert.equal(f.scheduled.length, 2);
  f.timer.close();
});
test('desligar descarta a participação pendente e não envia atrasado', async () => {
  const f = fixture();
  f.timer.noteActivity('geral', 'ana');
  f.disable();
  f.timer.reset();
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.scheduled.length, 1);
  f.timer.close();
});
test('resposta por menção consome a atividade e não cria um envio automático redundante', async () => {
  const f = fixture();
  f.timer.noteActivity('geral', 'ana');
  f.setTime(60000);
  f.timer.noteReply();
  assert.equal(f.canceled.length, 1);
  f.setTime(999999);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.scheduled.length, 1);
  f.timer.close();
});
test('falha ou ausência de resposta não cria tentativas durante o silêncio', async () => {
  const f = fixture(
    () => 0,
    async () => {
      throw new Error('rede');
    },
  );
  f.timer.noteActivity('geral', 'ana');
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.scheduled.length, 1);
  f.setTime(240000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
});
test('fechar o bot impede envio e novo agendamento', async () => {
  const f = fixture();
  f.timer.noteActivity('geral', 'ana');
  f.timer.close();
  f.setTime(120000);
  await f.timer.tick();
  f.timer.noteActivity('geral', 'bia');
  assert.equal(f.sent.length, 0);
  assert.equal(f.scheduled.length, 1);
});
test('desligar enquanto gera resposta invalida o envio em andamento', async () => {
  let now = 0,
    enabled = true,
    finish,
    sent = 0;
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
  timer.noteActivity('geral', 'ana');
  now = 120000;
  const pending = timer.tick();
  enabled = false;
  timer.reset();
  finish();
  await pending;
  assert.equal(sent, 0);
  timer.close();
});
test('atividade realmente nova durante envio pode agendar somente mais uma participação', async () => {
  let f;
  f = fixture(
    () => 0,
    async () => {
      f.timer.noteActivity('geral', 'bia');
    },
  );
  f.timer.noteActivity('geral', 'ana');
  f.setTime(120000);
  await f.timer.tick();
  assert.equal(f.scheduled.length, 2);
  f.timer.close();
});
