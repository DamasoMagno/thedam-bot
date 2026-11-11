import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { generateConversationReply, recallMemory } from '../src/chat/conversation.ts';
import { createReplyMediaPicker } from '../src/chat/media.ts';
import { ChatStore } from '../src/chat/store.ts';
import { createChatHandler } from '../src/chat/handler.ts';

test('assunto atual pode recuperar conexões do corpus antigo, sem IA', () => {
  const old = 'o dragão abriu uma padaria';
  const current = 'o dragão entrou na call';
  const text = generateConversationReply([old, current], current, {
    olderMessages: [old],
    random: () => 0.5,
  });
  assert.ok(text.includes('dragão'));
  assert.ok(text.length <= 160);
});
test('brincadeira usa a mesma frase, preservando limites e comandos musicais', () => {
  assert.equal(
    generateConversationReply(['o gato virou DJ'], '', {
      random: () => 0,
      generate: () => 'o gato virou DJ',
    }),
    'E se o gato virou DJ?',
  );
  assert.equal(
    generateConversationReply(['/tocar Queen'], '', {
      random: () => 0,
      generate: () => '/tocar Queen',
    }),
    '/tocar Queen',
  );
  assert.equal(
    generateConversationReply(['x'], '', { random: () => 0, generate: () => null }),
    null,
  );
});
test('nostalgia resgata só frases disponíveis e respeita rejeições e tamanho', () => {
  assert.equal(
    recallMemory(
      ['a velha call', 'rejeitada', 'x'.repeat(161)],
      ['rejeitada'],
      () => 0,
    ),
    'a velha call',
  );
  assert.equal(
    recallMemory([], [], () => 0),
    null,
  );
});
test('GIF contextual não repete os oito últimos nem falha quando a categoria se esgota', () => {
  const picker = createReplyMediaPicker();
  const urls = Array.from(
    { length: 9 },
    () =>
      picker({ chance: 1, random: () => 0, context: 'amor e coração' })[0].image.url,
  );
  assert.equal(new Set(urls).size, 9);
  const sleep = createReplyMediaPicker()({
    chance: 1,
    random: () => 0,
    context: 'estou com sono, vou dormir',
  });
  assert.match(sleep[0].image.url, /3oriO0OEd9QIDdllqo/);
  assert.equal(createReplyMediaPicker()({ chance: 0, context: 'gato' }), undefined);
});
test('nostalgia por menção não chama IA, não toca comandos antigos e não recupera mensagens expiradas', async () => {
  const client = new EventEmitter();
  client.user = { id: '123456789012345678' };
  const store = new ChatStore(':memory:');
  const now = Date.now();
  store.learn({ id: 'old', author: { id: 'ana' } }, '/tocar Queen', now - 2 * 86400000);
  store.learn({ id: 'today', author: { id: 'bia' } }, 'frase recente', now);
  store.learn(
    { id: 'expired', author: { id: 'ana' } },
    'frase expirada',
    now - 31 * 86400000,
  );
  let aiCalls = 0,
    musicCalls = 0;
  const sent = [];
  const controller = createChatHandler({
    client,
    store,
    channelId: 'geral',
    guildId: 'amigos',
    random: () => 0,
    mediaChance: 0,
    ai: {
      maybeReply: async () => {
        aiCalls++;
        return 'ia';
      },
    },
    onGenerated: async () => {
      musicCalls++;
    },
  });
  client.emit('messageCreate', {
    id: 'ask',
    channelId: 'geral',
    guildId: 'amigos',
    content: '<@123456789012345678> nostalgia',
    author: { id: 'ana' },
    mentions: { users: new Set([client.user.id]) },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return { id: 'reply' };
      },
    },
  });
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, '/tocar Queen');
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  assert.equal(aiCalls, 0);
  assert.equal(musicCalls, 0);
  controller.close();
});
