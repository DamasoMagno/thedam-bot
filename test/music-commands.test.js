import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createMusicCommands,
  registerMusicCommands,
  MUSIC_GUILD_ID,
} from '../src/music-commands.js';
import { MusicError } from '../src/error.js';

function fixture(run = async () => ({ current: null, queue: [] })) {
  const client = new EventEmitter();
  const calls = [];
  const handler = createMusicCommands({
    client,
    service: {
      run: async (...args) => {
        calls.push(args);
        return run(...args);
      },
    },
  });
  const replies = [];
  const interaction = {
    isChatInputCommand: () => true,
    guildId: MUSIC_GUILD_ID,
    user: { id: 'user' },
    commandName: 'fila',
    options: { getString: () => 'minha música' },
    async deferReply(value) {
      this.deferred = true;
      replies.push(value);
    },
    async reply(value) {
      this.replied = true;
      replies.push(value);
    },
    async editReply(value) {
      replies.push(value);
    },
  };
  return { client, handler, interaction, replies, calls };
}
test('slash toca o primeiro resultado usando a identidade do Discord e o serviço compartilhado', async () => {
  const f = fixture(async (_guild, _user, action) =>
    action === 'search'
      ? { tracks: [{ token: 'private-result', title: 'Música' }] }
      : { queue: [], current: { title: 'Música' } },
  );
  f.interaction.commandName = 'tocar';
  await f.handler.handle(f.interaction);
  assert.deepEqual(f.calls, [
    [MUSIC_GUILD_ID, 'user', 'search', { query: 'minha música', provider: 'youtube' }],
    [MUSIC_GUILD_ID, 'user', 'enqueue', { token: 'private-result' }],
  ]);
  assert.match(f.replies.at(-1).content, /Adicionada/);
  assert.deepEqual(f.replies.at(-1).allowedMentions.parse, []);
  assert.ok(f.replies[0].flags);
  f.handler.close();
  assert.equal(f.client.listenerCount('interactionCreate'), 0);
});
test('outro servidor e interações não relacionadas não executam ações', async () => {
  const f = fixture();
  f.interaction.guildId = 'other';
  await f.handler.handle(f.interaction);
  assert.equal(f.calls.length, 0);
  assert.match(f.replies[0].content, /somente no servidor Amigos/);
  f.interaction.commandName = 'outro';
  await f.handler.handle(f.interaction);
  assert.equal(f.replies.length, 1);
});
test('erros de autorização da call são apresentados sem continuar a busca', async () => {
  const f = fixture(async () => {
    throw new MusicError(409, 'Entre em uma call de voz do Discord primeiro.');
  });
  f.interaction.commandName = 'tocar';
  await f.handler.handle(f.interaction);
  assert.equal(f.calls.length, 1);
  assert.match(f.replies.at(-1).content, /Entre em uma call/);
});
test('busca sem resultados não tenta conectar; cliques repetidos são limitados', async () => {
  const f = fixture(async () => ({ tracks: [] }));
  f.interaction.commandName = 'tocar';
  await f.handler.handle(f.interaction);
  assert.match(f.replies.at(-1).content, /Não encontrei/);
  assert.equal(f.calls.length, 1);
  await f.handler.handle(f.interaction);
  assert.equal(f.calls.length, 1);
  assert.match(f.replies.at(-1).content, /Aguarde/);
});
test('cada controle encaminha a ação correta e a fila respeita o limite da mensagem', async () => {
  for (const [name, action] of Object.entries({
    fila: 'state',
    pausar: 'pause',
    continuar: 'resume',
    pular: 'skip',
    parar: 'stop',
  })) {
    const f = fixture(async () => ({
      current: { title: 'Atual' },
      queue: Array.from({ length: 50 }, () => ({ title: '*'.repeat(200) })),
    }));
    f.interaction.commandName = name;
    await f.handler.handle(f.interaction);
    assert.equal(f.calls[0][2], action);
    assert.ok(f.replies.at(-1).content.length < 2000);
  }
});
test('comandos são registrados somente no Amigos sem substituir comandos de outros módulos', async () => {
  const commands = [];
  await registerMusicCommands({
    application: {
      commands: { create: async (command, guild) => commands.push({ command, guild }) },
    },
  });
  assert.equal(commands.length, 6);
  assert.ok(commands.every(({ guild }) => guild === MUSIC_GUILD_ID));
});
