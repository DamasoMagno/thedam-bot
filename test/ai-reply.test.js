import test from 'node:test';
import assert from 'node:assert/strict';
import { AiReplyService } from '../src/ai/reply-service.ts';
import { ChatStore } from '../src/chat/store.ts';
const config = { key: 'test-private', model: 'test', chance: 1, dailyLimit: 2 };
test('IA é limitada por dia e manda só contexto curto, sem armazenar na API', async () => {
  const store = new ChatStore(':memory:');
  const payloads = [];
  const ai = new AiReplyService(
    config,
    store,
    async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Um gato virou DJ.' }],
            },
          ],
        }),
      };
    },
    () => 0,
  );
  assert.equal(await ai.maybeReply('a'.repeat(1000)), 'Um gato virou DJ.');
  await ai.maybeReply('outro');
  assert.equal(await ai.maybeReply('terceiro'), null);
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].store, false);
  assert.ok(JSON.parse(payloads[0].input).contexto.length <= 500);
  store.close();
});
test('falha de saldo não derruba Markov nem gera tentativas em loop', async () => {
  const store = new ChatStore(':memory:');
  let calls = 0;
  const ai = new AiReplyService(
    config,
    store,
    async () => {
      calls++;
      return { ok: false, status: 429 };
    },
    () => 0,
  );
  assert.equal(await ai.maybeReply('oi'), null);
  assert.equal(await ai.maybeReply('outra'), null);
  assert.equal(calls, 1);
  assert.match(ai.status().status, /saldo/);
  store.close();
});
test('chance zero não chama API e respostas não conseguem notificar pessoas', async () => {
  const store = new ChatStore(':memory:');
  let calls = 0;
  const off = new AiReplyService(
    { ...config, chance: 0 },
    store,
    async () => {
      calls++;
    },
    () => 0,
  );
  await off.maybeReply('oi');
  assert.equal(calls, 0);
  const ai = new AiReplyService(
    config,
    store,
    async () => ({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '@everyone <@123456789012345678> ' + 'x'.repeat(200),
              },
            ],
          },
        ],
      }),
    }),
    () => 0,
  );
  const text = await ai.maybeReply('oi');
  assert.ok(text.length <= 160);
  assert.ok(!text.includes('@'));
  store.close();
});

test('OpenRouter usa chat completions e um modelo gratuito com os mesmos limites', async () => {
  const store = new ChatStore(':memory:');
  const requests = [];
  const ai = new AiReplyService(
    { ...config, provider: 'openrouter', model: 'openrouter/free' },
    store,
    async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body), headers: options.headers });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'O gato virou DJ do churrasco.' } }],
        }),
      };
    },
    () => 0,
  );
  assert.equal(await ai.maybeReply('uma conversa'), 'O gato virou DJ do churrasco.');
  assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(requests[0].body.model, 'openrouter/free');
  assert.equal(requests[0].headers['X-Title'], 'TheDam');
  assert.equal(requests[0].body.messages[0].role, 'system');
  assert.equal(requests[0].body.reasoning, undefined);
  store.close();
});
test('OpenRouter bloqueia modelo pago antes de fazer requisição', async () => {
  const store = new ChatStore(':memory:');
  let calls = 0;
  const ai = new AiReplyService(
    { ...config, provider: 'openrouter', model: 'openai/gpt-4o' },
    store,
    async () => {
      calls++;
    },
    () => 0,
  );
  assert.equal(await ai.maybeReply('oi'), null);
  assert.equal(calls, 0);
  assert.match(ai.status().status, /pago bloqueado/);
  store.close();
});

test('OpenRouter limita a 30 tentativas mesmo com configuração maior e reinício', async () => {
  const store = new ChatStore(':memory:');
  let calls = 0;
  const options = {
    ...config,
    provider: 'openrouter',
    model: 'openrouter/free',
    dailyLimit: 200,
  };
  const fetcher = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Oi!' } }] }),
    };
  };
  for (let i = 0; i < 35; i++) {
    const service = new AiReplyService(options, store, fetcher, () => 0);
    await service.maybeReply('oi');
  }
  assert.equal(calls, 30);
  store.close();
});
