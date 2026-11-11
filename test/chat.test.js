import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { safeText, generateText } from '../src/chat/model.js';
import { ChatStore } from '../src/chat/store.js';
import { createChatHandler } from '../src/chat/handler.js';

test('Markov não armazena segredos, links, emails, números longos ou menções', () => {
  for (const text of [
    'minha senha e segredo',
    'mande https://example.com',
    'email eu@exemplo.com',
    'numero 11999999999',
    'ola @everyone',
    'token abcdefg',
    '<@123456789012345678> oi',
  ])
    assert.equal(safeText(text), null, text);
  assert.equal(safeText('oi'), 'oi');
  assert.equal(safeText(''), null);
  assert.equal(
    safeText('o dragão apareceu no meio da call'),
    'o dragão apareceu no meio da call',
  );
});
test('Markov limita o corpus e apaga mensagens/favoritos', () => {
  const store = new ChatStore(':memory:');
  for (let i = 0; i < 2010; i++)
    store.learn(
      { id: String(i), author: { id: 'ana' } },
      'o dragão apareceu no meio da call',
    );
  assert.equal(store.texts().length, 2000);
  store.remember('favorite', 'o dragão foi dormir');
  assert.equal(store.favorites().length, 1);
  store.clear();
  assert.equal(store.texts().length, 0);
  assert.equal(store.favorites().length, 0);
  store.close();
});
test('pouca conversa não produz cópia de uma mensagem antiga', () => {
  assert.equal(generateText(['o dragão apareceu na nossa call']), null);
  assert.equal(generateText(Array(20).fill('o dragão apareceu na nossa call')), null);
});
test('Markov só coleta no geral e só responde quando mencionado, sem pings ou imagens', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const store = new ChatStore(':memory:');
  const controller = createChatHandler({
    client,
    store,
    channelId: 'geral',
    guildId: 'amigos',
  });
  const sent = [];
  const message = {
    id: 'm1',
    guildId: 'amigos',
    channelId: 'outro',
    content: 'o dragão entrou na nossa call',
    author: { id: 'ana' },
    mentions: { users: new Set() },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return { id: 'response' };
      },
    },
  };
  client.emit('messageCreate', message);
  await new Promise(setImmediate);
  assert.equal(store.texts().length, 0);
  message.channelId = 'geral';
  client.emit('messageCreate', message);
  await new Promise(setImmediate);
  assert.equal(store.texts().length, 1);
  assert.equal(sent.length, 0);
  message.id = 'm2';
  message.content = '<@bot> ajuda';
  message.mentions.users.add('bot');
  client.emit('messageCreate', message);
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  assert.equal(sent[0].allowedMentions.repliedUser, false);
  assert.equal(sent[0].files, undefined);
  controller.close();
});
test('música é rejeitada fora do Amigos antes de consultar o Discord', async () => {
  const { PlayerService } = await import('../src/player-service.js');
  let checked = 0;
  const service = new PlayerService({
    gateway: {
      authorize() {
        checked++;
      },
    },
    catalog: {},
    source() {},
  });
  await assert.rejects(
    service.run('outro', 'pessoa', 'state'),
    (error) => error.status === 403,
  );
  assert.equal(checked, 0);
  service.close();
});

test('geração por palavra mistura fragmentos em vez de copiar o corpus', () => {
  const rows = Array.from({ length: 1 }, () => [
    'vou jogar com o dragão hoje',
    'vou jogar com o gato amanhã',
    'o dragão foi dormir depois',
    'o gato foi cantar depois',
  ]).flat();
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const output = generateText(rows, { seed: 'dragão', random });
  assert.ok(output);
  assert.ok(output.includes('dragão'));
  assert.ok(!rows.includes(output));
  assert.ok(output.length <= 240);
  const store = new ChatStore(':memory:');
  store.remember('id', output);
  store.reject('id', output);
  assert.equal(store.favorites().length, 0);
  assert.deepEqual(store.rejected(), [output]);
  store.clear();
  assert.deepEqual(store.rejected(), []);
  store.close();
});

test('modo sempre responde a mensagens seguidas sem menção, ignora bots e filtros e permite desligar', async () => {
  const client = new EventEmitter();
  client.user = { id: '123456789012345678' };
  const store = new ChatStore(':memory:');
  store.setting('auto', 'always');
  const sent = [];
  let generated = 0;
  const controller = createChatHandler({
    client,
    store,
    channelId: 'geral',
    guildId: 'amigos',
    now: () => 100000,
    generate: () => `uma nova frase engraçada número ${++generated}`,
  });
  const message = {
    id: 'one',
    guildId: 'amigos',
    channelId: 'geral',
    author: { id: 'ana' },
    content: 'o dragão entrou na nossa call',
    mentions: { users: new Set() },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return { id: String(sent.length) };
      },
    },
  };
  const emit = async (changes = {}) => {
    client.emit('messageCreate', { ...message, ...changes });
    await new Promise(setImmediate);
  };
  await emit();
  await emit({ id: 'two', content: 'vamos jogar juntos agora' });
  assert.equal(sent.length, 2);
  await emit({ author: { id: 'otherbot', bot: true } });
  await emit({ content: 'minha senha e segredo' });
  await emit({ channelId: 'outro' });
  await emit({ guildId: 'outro' });
  assert.equal(sent.length, 2);
  await emit({
    content: 'automatico off',
    member: { permissions: { has: () => true } },
  });
  assert.equal(
    store.setting('auto'),
    'always',
    'mensagens sem menção não executam comandos',
  );
  await emit({
    content: '<@123456789012345678> automatico off',
    mentions: { users: new Set([client.user.id]) },
    member: { permissions: { has: () => false } },
  });
  assert.equal(store.setting('auto'), 'always');
  await emit({
    content: '<@123456789012345678> automatico off',
    mentions: { users: new Set([client.user.id]) },
    member: { permissions: { has: () => true } },
  });
  assert.equal(store.setting('auto'), 'false');
  const before = sent.length;
  await emit();
  assert.equal(sent.length, before);
  assert.ok(sent.every((payload) => payload.allowedMentions.parse.length === 0));
  controller.close();
});

test('modo sempre responde mesmo a texto curto e sem aprendizado suficiente', async () => {
  const client = new EventEmitter();
  client.user = { id: 'bot' };
  const store = new ChatStore(':memory:');
  store.setting('auto', 'always');
  const sent = [];
  const controller = createChatHandler({
    client,
    store,
    channelId: 'geral',
    guildId: 'amigos',
  });
  client.emit('messageCreate', {
    id: 'oi',
    guildId: 'amigos',
    channelId: 'geral',
    content: 'oi',
    author: { id: 'ana' },
    mentions: { users: new Set() },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return { id: 'reply' };
      },
    },
  });
  await new Promise(setImmediate);
  assert.deepEqual(store.texts(), ['oi']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /aprendendo/);
  controller.close();
});

test('repetições são aceitas e a geração pode evitar apenas respostas recentes', () => {
  for (const text of ['AI AI AI AI AI UIO UI', 'ai ai uio ui ai ai uio ui', 'oi oi oi'])
    assert.equal(safeText(text), text);
  assert.equal(safeText('AI AI UIO UI'), 'AI AI UIO UI');
  assert.equal(
    safeText('o gato foi dormir e o cachorro foi brincar'),
    'o gato foi dormir e o cachorro foi brincar',
  );
  assert.ok(safeText('AI AI AI AI AI UIO UI'));
  const rows = [
    'vou jogar com o dragão hoje',
    'vou jogar com o gato amanhã',
    'o dragão foi dormir depois',
    'o gato foi cantar depois',
  ];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const output = generateText(rows, { random });
  assert.ok(output);
  seed = 7;
  assert.notEqual(generateText(rows, { random, excluded: [output] }), output);
});

test('histórico importa apenas texto seguro do geral, preserva data, pagina e não gera respostas', async () => {
  const { importGeneralHistory, GENERAL_CHANNEL_ID, AMIGOS_GUILD_ID } =
    await import('../src/chat/history.js');
  const store = new ChatStore(':memory:');
  const time = Date.now();
  const row = (id, content, extra = {}) => ({
    id,
    content,
    createdTimestamp: time - 1000,
    author: { id: 'ana' },
    ...extra,
  });
  const pages = [
    new Map([
      ['10', row('10', 'o gato foi dormir hoje')],
      ['9', row('9', 'AI AI AI AI AI UIO UI')],
      ['8', row('8', 'mensagem de outro bot', { author: { id: 'bot', bot: true } })],
      ['7', row('7', 'minha senha e segredo')],
      ['6', row('6', 'oi')],
    ]),
    new Map([
      [
        '5',
        row('5', 'conversa muito antiga', { createdTimestamp: time - 31 * 86400000 }),
      ],
    ]),
  ];
  const fetches = [];
  const channel = {
    id: GENERAL_CHANNEL_ID,
    guildId: AMIGOS_GUILD_ID,
    messages: {
      fetch: async (options) => {
        fetches.push(options);
        return pages.shift();
      },
    },
  };
  const result = await importGeneralHistory({ channel, store, now: time });
  assert.deepEqual(result, { imported: 3, scanned: 6 });
  assert.deepEqual(fetches[1], { limit: 100, before: '6' });
  assert.equal(
    store.db.prepare('SELECT created FROM messages WHERE id=?').get('10').created,
    time - 1000,
  );
  await assert.rejects(
    importGeneralHistory({ channel: { ...channel, guildId: 'other' }, store }),
  );
  store.close();
});
