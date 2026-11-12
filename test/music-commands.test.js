import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createMusicCommands,
  registerMusicCommands,
  MUSIC_GUILD_ID,
} from '../src/music/commands.ts';
import { MusicError } from '../src/shared/music-error.ts';

function fixture(run = async () => ({ current: null, queue: [] })) {
  const client = new EventEmitter();
  const calls = [];
  const handler = createMusicCommands({
    client,
    service: {
      state: () => ({
        current: { title: 'Atual', provider: 'youtube' },
        paused: false,
        queue: [],
      }),
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
  interaction.isButton = () => false;
  interaction.isStringSelectMenu = () => false;
  return { client, handler, interaction, replies, calls };
}
test('busca por nome apresenta versões antes de conectar o bot', async () => {
  const f = fixture(async (_guild, _user, action) =>
    action === 'search'
      ? { tracks: [{ token: 'private-result', title: 'Música' }] }
      : { queue: [], current: { title: 'Música' } },
  );
  f.interaction.commandName = 'tocar';
  await f.handler.handle(f.interaction);
  assert.deepEqual(f.calls, [
    [MUSIC_GUILD_ID, 'user', 'search', { query: 'minha música', provider: 'youtube' }],
  ]);
  assert.match(f.replies.at(-1).content, /Escolha/);
  assert.equal(
    f.replies.at(-1).components[0].components[0].options[0].value,
    'private-result',
  );
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
      commands: {
        fetch: async () => ({ find: () => undefined }),
        create: async (command, guild) => commands.push({ command, guild }),
      },
    },
  });
  assert.equal(commands.length, 9);
  assert.ok(commands.every(({ guild }) => guild === MUSIC_GUILD_ID));
});

test('comandos musicais usam apenas os atalhos simples, sem versões duplicadas no dam', async () => {
  const { musicCommands } = await import('../src/music/command-definitions.ts');
  const root = musicCommands.map((command) => command.name);
  for (const name of [
    'musica',
    'tocar',
    'playlists',
    'fila',
    'pausar',
    'continuar',
    'pular',
    'parar',
  ])
    assert.ok(root.includes(name));
  const nested = musicCommands
    .find((command) => command.name === 'dam')
    .options.map((option) => option.name);
  for (const duplicate of [
    'tocar',
    'fila',
    'painel',
    'playlists',
    'criar-playlist',
    'importar-playlist',
  ])
    assert.ok(!nested.includes(duplicate));
});

test('mover faixa pelos botões atualiza a mesma mensagem privada, sem novos comandos', async () => {
  const f = fixture(async () => ({
    current: { title: 'Atual' },
    queue: [{ title: 'Depois', queueId: 'stable-id' }],
  }));
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isButton = () => true;
  f.interaction.customId = 'dam:moveUp:stable-id';
  f.interaction.message = { flags: { has: () => true } };
  f.interaction.deferUpdate = async () => {
    f.interaction.deferred = true;
    f.replies.push({ updated: true });
  };
  await f.handler.handle(f.interaction);
  assert.deepEqual(f.calls[0], [
    MUSIC_GUILD_ID,
    'user',
    'move',
    { id: 'stable-id', direction: 'up' },
  ]);
  assert.equal(f.replies[0].updated, true);
  assert.equal(
    f.replies
      .at(-1)
      .components.flatMap((row) => row.components)
      .find((item) => item.custom_id?.startsWith('dam:moveUp:')).disabled,
    true,
  );
  assert.deepEqual(f.replies.at(-1).allowedMentions.parse, []);
  f.handler.close();
});

test('playlist tem formulário para salvar faixas sem iniciar reprodução', async () => {
  const f = fixture();
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isButton = () => true;
  f.interaction.customId = 'dam:playlistAdd:my-list';
  let modal;
  f.interaction.showModal = async (value) => {
    modal = value.toJSON();
  };
  await f.handler.handle(f.interaction);
  assert.equal(modal.custom_id, 'dam:playlistInput:my-list');
  assert.equal(f.calls.length, 0);
  assert.equal(f.replies.length, 0);
  f.handler.close();
});
test('envio do formulário busca para a biblioteca e não chama enqueue', async () => {
  const f = fixture(async () => ({
    tracks: [{ title: 'Queen', token: 'library-token' }],
  }));
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isModalSubmit = () => true;
  f.interaction.customId = 'dam:playlistInput:my-list';
  f.interaction.fields = { getTextInputValue: () => 'Queen' };
  await f.handler.handle(f.interaction);
  assert.equal(f.calls[0][2], 'playlistSearch');
  assert.equal(f.calls[0][3].id, 'my-list');
  assert.equal(
    f.replies.at(-1).components[0].components[0].custom_id,
    'dam:playlistTrack:my-list',
  );
  assert.ok(!f.calls.some((call) => call[2] === 'enqueue'));
  f.handler.close();
});

test('playlist da call toca com uma seleção sem abrir edição', async () => {
  const f = fixture(async () => ({ current: { title: 'Música' }, queue: [] }));
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isStringSelectMenu = () => true;
  f.interaction.customId = 'dam:playPlaylist';
  f.interaction.values = ['saved-list'];
  const published = [];
  f.interaction.channel = {
    id: 'voice-chat',
    send: async (payload) => {
      published.push(payload);
      return { channelId: 'voice-chat', edit: async () => {} };
    },
  };
  await f.handler.handle(f.interaction);
  assert.deepEqual(f.calls[0], [
    MUSIC_GUILD_ID,
    'user',
    'playlistEnqueue',
    { id: 'saved-list' },
  ]);
  assert.equal(f.calls.length, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].flags, undefined);
  assert.match(f.replies.at(-1).content, /adicionada/);
  f.handler.close();
});
test('excluir playlist pede confirmação e o cancelamento volta à lista', async () => {
  const f = fixture();
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isButton = () => true;
  f.interaction.customId = 'dam:deleteAsk:list';
  await f.handler.handle(f.interaction);
  assert.equal(f.calls.length, 0);
  const buttons = f.replies.at(-1).components[0].components;
  assert.equal(buttons[0].custom_id, 'dam:deletePlaylist:list');
  assert.equal(buttons[1].custom_id, 'dam:playlistOpen:list');
  f.handler.close();
});
test('formulário de playlist reutiliza a mensagem privada sem criar novas respostas', async () => {
  const f = fixture(async () => ({
    playlist: { id: 'list', name: 'Rock', tracks: [], revision: 'revision' },
  }));
  f.interaction.isChatInputCommand = () => false;
  f.interaction.isModalSubmit = () => true;
  f.interaction.isFromMessage = () => true;
  f.interaction.message = { flags: { has: () => true } };
  f.interaction.customId = 'dam:libraryInput:createPlaylist';
  f.interaction.fields = { getTextInputValue: (id) => (id === 'name' ? 'Rock' : '') };
  f.interaction.deferUpdate = async () => {
    f.interaction.deferred = true;
    f.replies.push({ updated: true });
  };
  await f.handler.handle(f.interaction);
  assert.equal(f.replies[0].updated, true);
  assert.equal(f.calls[0][2], 'createPlaylist');
  assert.match(f.replies.at(-1).content, /Rock/);
  f.handler.close();
});
