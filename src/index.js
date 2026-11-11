import { createMusicCommands, registerMusicCommands } from './music-commands.js';
import { ChatStore } from './chat/store.js';
import { createChatHandler } from './chat/handler.js';
import { configuration } from './config.js';
import { Catalog } from './catalog.js';
import { DiscordGateway } from './discord-gateway.js';
import { createAudioSource } from './audio-source.js';
import { PlayerService } from './player-service.js';
import { createServer } from './http.js';
const config = configuration();
if (config.markovEnabled) {
  if (config.markovChannel !== '1379585304029171805')
    throw new Error('Preencha MARKOV_CHANNEL_ID com o ID do geral.');
  const response = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
    headers: { Authorization: 'Bot ' + config.token },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  const app = await response?.json().catch(() => null);
  if (!app?.flags || !(app.flags & ((1 << 18) | (1 << 19)))) {
    config.markovEnabled = false;
    console.warn(
      'Markov desativado: habilite Message Content Intent no Developer Portal. Música continua disponível.',
    );
  }
}
let chat, musicCommandsHandler;
const gateway = new DiscordGateway(config);
const catalog = new Catalog(config);
const service = new PlayerService({
  catalog,
  gateway,
  source: (track, fail) => createAudioSource(config, track, fail),
});
const server = createServer({ config, service, ready: () => gateway.client.isReady() });
try {
  await gateway.start();
  musicCommandsHandler = createMusicCommands({ client: gateway.client, service });
  try {
    await registerMusicCommands(gateway.client);
    console.log('Comandos de música disponíveis no servidor Amigos.');
  } catch {
    console.warn(
      'Não foi possível registrar os comandos de música. Confira o escopo applications.commands.',
    );
  }
  if (config.markovEnabled)
    chat = createChatHandler({
      client: gateway.client,
      store: new ChatStore(config.markovPath),
      channelId: config.markovChannel,
      guildId: '1379585303295299714',
    });
  server.listen(config.port, config.host, () => console.log('Bot de música pronto.'));
} catch {
  console.error(
    'Não foi possível iniciar o bot. Confira token, conexão e dependências.',
  );
  service.close();
  gateway.close();
  process.exitCode = 1;
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    chat?.close();
    musicCommandsHandler?.close();
    service.close();
    gateway.close();
    server.close();
  });
