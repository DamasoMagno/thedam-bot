import { AiReplyService } from './ai/reply-service.ts';
import { createGeneratedMusicActions } from './chat/music-actions.ts';
import { LibraryRepository } from './music/library-repository.ts';
import { checkMessageContentAccess } from './discord/intent-access.ts';
import { GENERAL_CHANNEL_ID, AMIGOS_GUILD_ID } from './config/constants.ts';
import { createMusicCommands, registerMusicCommands } from './music/commands.ts';
import { ChatStore } from './chat/store.ts';
import { createChatHandler } from './chat/handler.ts';
import { configuration } from './config/index.ts';
import { Catalog } from './music/catalog.ts';
import { DiscordGateway } from './discord/gateway.ts';
import { createAudioSource } from './music/audio-source.ts';
import { PlayerService } from './music/player-service.ts';
import { createServer } from './http/server.ts';
const config = configuration();
const runtime: import('./music/types.ts').Diagnostics = {
  commands: false,
  spotify: Boolean(config.spotifyId && config.spotifySecret),
  markovReason: 'desativado',
  audioError: null,
};
if (config.markovEnabled) {
  if (config.markovChannel !== GENERAL_CHANNEL_ID)
    throw new Error('Use o canal geral do Amigos.');
  const access = await checkMessageContentAccess(config.token);
  config.markovEnabled = access.enabled;
  runtime.markovReason = access.enabled ? 'ativo' : access.reason;
  if (!access.enabled) console.warn(access.reason);
}
let chat: ReturnType<typeof createChatHandler> | undefined,
  musicCommandsHandler: ReturnType<typeof createMusicCommands> | undefined;
const gateway = new DiscordGateway(config);
const catalog = new Catalog(config);
const library = new LibraryRepository(config.musicPath);
const service = new PlayerService({
  library,
  diagnostics: () => ({ ...runtime, markov: chat?.status() }),
  catalog,
  gateway,
  source: (track, fail) =>
    createAudioSource(config, track, (error) => {
      runtime.audioError = error.message;
      fail(error);
    }),
});
const server = createServer({ config, service, ready: () => gateway.client.isReady() });
try {
  await gateway.start();
  musicCommandsHandler = createMusicCommands({
    client: gateway.client,
    service,
    chat: () => chat,
    diagnostics: () => runtime,
  });
  try {
    await registerMusicCommands(gateway.client);
    runtime.commands = true;
    console.log('Comandos de música disponíveis no servidor Amigos.');
  } catch {
    console.warn(
      'Não foi possível registrar os comandos de música. Confira o escopo applications.commands.',
    );
  }
  if (config.markovEnabled) {
    const store = new ChatStore(config.markovPath);
    const ai = new AiReplyService(
      {
        key: config.openaiKey,
        model: config.openaiModel,
        chance: config.openaiChance,
        dailyLimit: config.openaiDailyLimit,
      },
      store,
    );
    chat = createChatHandler({
      ai,
      mediaChance: config.mediaChance,
      onGenerated: createGeneratedMusicActions(service),
      client: gateway.client,
      store,
      channelId: config.markovChannel,
      guildId: AMIGOS_GUILD_ID,
    });
  }
  server.listen(config.port, config.host, () => console.log('Bot de música pronto.'));
} catch {
  console.error(
    'Não foi possível iniciar o bot. Confira token, conexão e dependências.',
  );
  service.close();
  gateway.close();
  library.close();
  process.exitCode = 1;
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    chat?.close();
    musicCommandsHandler?.close();
    service.close();
    gateway.close();
    server.close();
    library.close();
  });
