import { LastFmClient } from './lastfm/client.ts';
import { LastFmRepository } from './lastfm/repository.ts';
import { LastFmService } from './lastfm/service.ts';
import { LastFmScrobbler } from './lastfm/scrobbler.ts';
import { VoiceController } from './voice/controller.ts';
import { VoiceTranscriber } from './ai/speech-service.ts';
import { VoiceUsageRepository } from './ai/voice-usage-repository.ts';
import { createResolvedSource } from './music/resolved-source.ts';
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
  diagnostics: () => ({
    ...runtime,
    search: catalog.searchStatus(),
    markov: chat?.status(),
  }),
  catalog,
  gateway,
  source: (track, fail) => {
    const startedAt = performance.now();
    return createResolvedSource(
      track,
      catalog,
      (resolved, onFailure, location) =>
        createAudioSource(
          config,
          resolved,
          (error) => {
            catalog.invalidateAudio(resolved.id);
            onFailure(error);
          },
          {
            location,
            onReady: () => {
              runtime.audioStartupMs = Math.round(performance.now() - startedAt);
              runtime.audioError = null;
            },
          },
        ),
      (error) => {
        runtime.audioError = error?.message || 'Falha na fonte de áudio.';
        fail(error);
      },
    );
  },
});
const voiceUsage =
  config.voiceCommandsEnabled && config.openrouterKey
    ? new VoiceUsageRepository(config.voiceUsagePath)
    : undefined;
const voice = voiceUsage
  ? new VoiceController(
      service,
      new VoiceTranscriber({
        key: config.openrouterKey,
        model: config.voiceModel,
        dailyLimit: config.voiceDailyLimit,
        usage: voiceUsage,
      }),
    )
  : undefined;
const lastfmRepository =
  config.lastfmKey && config.lastfmSecret
    ? new LastFmRepository(config.lastfmPath, config.secret!)
    : undefined;
const lastfm = lastfmRepository
  ? new LastFmService(
      new LastFmClient(config.lastfmKey, config.lastfmSecret),
      lastfmRepository,
    )
  : undefined;
const scrobbler = lastfm ? new LastFmScrobbler(lastfm) : undefined;
let scrobbleWarning = false;
function updateScrobbles() {
  if (!scrobbler) return;
  try {
    const state = service.state(AMIGOS_GUILD_ID);
    const channel = state.channelId
      ? gateway.client.guilds.cache
          .get(AMIGOS_GUILD_ID)
          ?.channels.cache.get(state.channelId)
      : undefined;
    const listeners = new Set(
      channel?.isVoiceBased()
        ? [...channel.members.values()]
            .filter((member) => !member.user.bot && !member.voice.deaf)
            .map((member) => member.id)
        : [],
    );
    scrobbler.update(state, listeners);
  } catch {
    if (!scrobbleWarning)
      console.warn(
        'Falha local no Last.fm. A reprodução musical continua independente.',
      );
    scrobbleWarning = true;
  }
}
const stopScrobbleUpdates = scrobbler ? service.onChange(updateScrobbles) : undefined;
const scrobbleTimer = scrobbler ? setInterval(updateScrobbles, 10000) : undefined;
scrobbleTimer?.unref();
if (scrobbler) gateway.client.on('voiceStateUpdate', updateScrobbles);
let lastfmClosed = false;
function closeLastFm() {
  if (lastfmClosed) return;
  lastfmClosed = true;
  clearInterval(scrobbleTimer);
  stopScrobbleUpdates?.();
  gateway.client.off('voiceStateUpdate', updateScrobbles);
  scrobbler?.close();
  lastfm?.close();
  lastfmRepository?.close();
}
const server = createServer({ config, service, ready: () => gateway.client.isReady() });
try {
  await gateway.start();
  musicCommandsHandler = createMusicCommands({
    client: gateway.client,
    service,
    voice,
    lastfm,
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
        provider: config.aiProvider,
        key:
          config.aiProvider === 'openrouter' ? config.openrouterKey : config.openaiKey,
        model:
          config.aiProvider === 'openrouter'
            ? config.openrouterModel
            : config.openaiModel,
        chance: config.openaiChance,
        dailyLimit: config.openaiDailyLimit,
      },
      store,
    );
    const generalChannel = await gateway.client.channels
      .fetch(GENERAL_CHANNEL_ID)
      .catch(() => null);
    chat = createChatHandler({
      channel:
        generalChannel?.isSendable() &&
        'guildId' in generalChannel &&
        generalChannel.guildId === AMIGOS_GUILD_ID
          ? generalChannel
          : undefined,
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
  closeLastFm();
  voice?.close();
  voiceUsage?.close();
  service.close();
  gateway.close();
  library.close();
  process.exitCode = 1;
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    chat?.close();
    musicCommandsHandler?.close();
    closeLastFm();
    voice?.close();
    voiceUsage?.close();
    service.close();
    gateway.close();
    server.close();
    library.close();
  });
