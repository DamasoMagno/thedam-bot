import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityTimer } from '../src/chat/activity-timer.js';

function fixture(speakImpl) {
  let time = 0,
    active = true,
    canceled = false;
  const sent = [];
  const timer = createActivityTimer({
    now: () => time,
    enabled: () => active,
    speak: async (channel) => {
      sent.push(channel);
      await speakImpl?.();
    },
    schedule: () => ({ unref() {} }),
    cancel: () => {
      canceled = true;
    },
  });
  return {
    timer,
    sent,
    setTime: (value) => {
      time = value;
    },
    disable: () => {
      active = false;
    },
    get canceled() {
      return canceled;
    },
  };
}
test('temporizador não fala sem atividade, espera cinco minutos e fica quieto após inatividade', async () => {
  const f = fixture();
  f.setTime(300000);
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  f.timer.noteActivity('geral');
  await f.timer.tick();
  assert.deepEqual(f.sent, ['geral']);
  f.setTime(301000);
  f.timer.noteActivity('geral');
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.setTime(1000000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
  assert.equal(f.canceled, true);
});
test('respeita modo desativado, resposta recente e encerramento', async () => {
  const f = fixture();
  f.timer.noteActivity('geral');
  f.setTime(300000);
  f.timer.noteReply();
  await f.timer.tick();
  assert.equal(f.sent.length, 0);
  f.setTime(360000);
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.disable();
  f.setTime(660000);
  f.timer.noteActivity('geral');
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
});
test('não sobrepõe envios e não repete a tentativa no mesmo intervalo', async () => {
  let release;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.timer.noteActivity('geral');
  f.setTime(300000);
  const first = f.timer.tick();
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  release();
  await first;
  await f.timer.tick();
  assert.equal(f.sent.length, 1);
  f.timer.close();
});
