import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/http/server.ts';
test('API privada recusa segredo ausente e valida a identidade antes de controlar a fila', async (t) => {
  const calls = [];
  const secret = 'a'.repeat(64);
  const server = createServer({
    config: { secret },
    service: {
      run: async (...args) => {
        calls.push(args);
        return { queue: [] };
      },
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/health')).status, 401);
  const headers = {
    authorization: 'Bearer ' + secret,
    'content-type': 'application/json',
  };
  assert.equal((await fetch(base + '/health', { headers })).status, 200);
  const path = '/v1/guilds/200000000000000001/state';
  assert.equal(
    (await fetch(base + path, { method: 'POST', headers, body: '{"userId":"wrong"}' }))
      .status,
    400,
  );
  assert.equal(calls.length, 0);
  const response = await fetch(base + path, {
    method: 'POST',
    headers,
    body: '{"userId":"100000000000000001"}',
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});
