import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { safeText, generateText } from '../src/chat/model.ts';
import { ChatStore } from '../src/chat/store.ts';
import { createChatHandler } from '../src/chat/handler.ts';

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
  const { PlayerService } = await import('../src/music/player-service.ts');
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

test('modos antigos não respondem a cada mensagem e administradores podem desligar', async () => {
  const client = new EventEmitter();
  client.user = { id: '123456789012345678' };
  const store = new ChatStore(':memory:');
  store.setting('auto', 'always');
  const sent = [];
  const controller = createChatHandler({
    client,
    store,
    channelId: 'geral',
    guildId: 'amigos',
  });
  const message = {
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
  };
  client.emit('messageCreate', message);
  await new Promise(setImmediate);
  assert.deepEqual(store.texts(), ['oi']);
  assert.equal(sent.length, 0);
  assert.throws(() => controller.configure(false, 'discreet'), /Gerenciar/);
  controller.configure(true, 'discreet');
  assert.equal(store.setting('auto'), 'timer');
  controller.configure(true, 'mention');
  assert.equal(store.setting('auto'), 'false');
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
    await import('../src/chat/history.ts');
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

test('mensagens expiradas são removidas mesmo sem novo aprendizado', () => {
  const store = new ChatStore(':memory:');
  store.db
    .prepare('INSERT INTO messages VALUES(?,?,?,?)')
    .run('old', 'ana', 'texto antigo', Date.now() - 31 * 86400000);
  assert.deepEqual(store.texts(), []);
  store.close();
});
test('respostas geradas respeitam 160 caracteres', () => {
  const rows = [
    'vou jogar com o dragão hoje',
    'vou jogar com o gato amanhã',
    'o dragão foi dormir depois',
    'o gato foi cantar depois',
  ];
  for (let i = 0; i < 20; i++) {
    const output = generateText(rows);
    if (output) assert.ok(output.length <= 160);
  }
});
