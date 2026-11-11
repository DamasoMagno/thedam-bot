import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMessageContentAccess } from '../src/discord/intent-access.ts';
test('erro temporário de rede é repetido sem diagnosticar falta de permissão', async () => {
  let attempts = 0;
  const result = await checkMessageContentAccess('test', {
    sleep: async () => {},
    fetchImpl: async () => {
      attempts++;
      if (attempts < 3) throw new Error('network');
      return { ok: true, json: async () => ({ flags: 1 << 19 }) };
    },
  });
  assert.equal(attempts, 3);
  assert.equal(result.enabled, true);
});
test('indisponibilidade e intent desativada têm mensagens diferentes', async () => {
  const unavailable = await checkMessageContentAccess('test', {
    sleep: async () => {},
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  assert.match(unavailable.reason, /consultar/);
  const denied = await checkMessageContentAccess('test', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ flags: 0 }) }),
  });
  assert.equal(denied.enabled, false);
  assert.match(denied.reason, /Message Content Intent/);
});
