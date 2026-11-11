import { ApplicationCommandOptionType, MessageFlags, escapeMarkdown } from 'discord.js';
import { MusicError } from './error.js';

export const MUSIC_GUILD_ID = '1379585303295299714';
export const musicCommands = [
  {
    name: 'tocar',
    description: 'Tocar uma música ou adicionar à fila da sua call',
    options: [
      {
        name: 'musica',
        description: 'Nome ou link do YouTube ou Spotify',
        type: ApplicationCommandOptionType.String,
        required: true,
        max_length: 240,
      },
    ],
  },
  { name: 'fila', description: 'Ver a música atual e as próximas da sua call' },
  { name: 'pausar', description: 'Pausar a música da sua call' },
  { name: 'continuar', description: 'Continuar a música da sua call' },
  { name: 'pular', description: 'Pular para a próxima música da sua call' },
  { name: 'parar', description: 'Limpar a fila e desconectar o bot da sua call' },
];
const actions = {
  fila: 'state',
  pausar: 'pause',
  continuar: 'resume',
  pular: 'skip',
  parar: 'stop',
};
const title = (track) => escapeMarkdown(String(track?.title || 'Música').slice(0, 100));
const payload = (content) => ({
  content,
  allowedMentions: { parse: [], repliedUser: false },
});

export function createMusicCommands({ client, service, now = Date.now }) {
  const pending = new Set();
  const lastRequests = new Map();
  async function handle(interaction) {
    if (
      !interaction.isChatInputCommand() ||
      !musicCommands.some(({ name }) => name === interaction.commandName)
    )
      return;
    try {
      if (interaction.guildId !== MUSIC_GUILD_ID) {
        await interaction.reply({
          ...payload('Música disponível somente no servidor Amigos.'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const user = interaction.user.id;
      if (
        pending.has(user) ||
        pending.size >= 20 ||
        now() - (lastRequests.get(user) ?? -Infinity) < 3000
      ) {
        await interaction.reply({
          ...payload('Aguarde um instante antes do próximo comando.'),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      pending.add(user);
      lastRequests.set(user, now());
      if (lastRequests.size > 500)
        lastRequests.delete(lastRequests.keys().next().value);
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let state;
        if (interaction.commandName === 'tocar') {
          const query = interaction.options.getString('musica', true);
          const result = await service.run(interaction.guildId, user, 'search', {
            query,
            provider: 'youtube',
          });
          const track = result.tracks[0];
          if (!track)
            throw new MusicError(
              404,
              'Não encontrei esta música. Tente outro nome ou link.',
            );
          state = await service.run(interaction.guildId, user, 'enqueue', {
            token: track.token,
          });
          await interaction.editReply(
            payload(
              `Adicionada à reprodução: **${title(track)}**.${state.error ? ' ' + state.error : ''}`,
            ),
          );
          return;
        }
        state = await service.run(
          interaction.guildId,
          user,
          actions[interaction.commandName],
        );
        const messages = {
          pausar: 'Música pausada.',
          continuar: 'Reprodução retomada.',
          pular: state.current
            ? `Tocando: **${title(state.current)}**.`
            : 'Fila encerrada.',
          parar: 'Fila encerrada. O bot saiu da call.',
        };
        const queue = state.queue
          .slice(0, 10)
          .map((track, index) => `${index + 1}. ${title(track)}`)
          .join('\n');
        const content =
          interaction.commandName === 'fila'
            ? state.current
              ? `**${state.paused ? 'Pausada' : 'Tocando'}:** ${title(state.current)}\n${queue || 'Nenhuma música na fila.'}${state.queue.length > 10 ? `\nE mais ${state.queue.length - 10} música(s).` : ''}`
              : 'Nenhuma música está tocando.'
            : messages[interaction.commandName];
        await interaction.editReply(payload(content));
      } finally {
        pending.delete(user);
      }
    } catch (error) {
      const response = payload(
        error instanceof MusicError
          ? error.message
          : 'Não foi possível concluir. Tente novamente.',
      );
      try {
        if (interaction.deferred || interaction.replied)
          await interaction.editReply(response);
        else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
      } catch {
        console.warn('Não foi possível responder ao comando de música.');
      }
    }
  }
  client.on('interactionCreate', handle);
  return { handle, close: () => client.off('interactionCreate', handle) };
}

export async function registerMusicCommands(client) {
  for (const command of musicCommands)
    await client.application.commands.create(command, MUSIC_GUILD_ID);
}
