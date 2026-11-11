import type {
  Client,
  Interaction,
  ChatInputCommandInteraction,
  SendableChannels,
} from 'discord.js';
import type { PlayerService } from './player-service.ts';
import type { MusicInput, Diagnostics, ServiceResult } from './types.ts';
import type { createChatHandler } from '../chat/handler.ts';
import { MessageFlags } from 'discord.js';
import { MusicError } from '../shared/music-error.ts';
import { AMIGOS_GUILD_ID } from '../config/constants.ts';
import { musicCommands, registerMusicCommands } from './command-definitions.ts';
import {
  MusicPanels,
  messagePayload,
  safeTitle,
  selection,
  row,
  button,
} from './presentation.ts';
export { musicCommands, registerMusicCommands };
export const MUSIC_GUILD_ID = AMIGOS_GUILD_ID;
const modeNames: Record<string, string> = {
  mention: 'só por menção',
  discreet: 'discreto',
  participative: 'mais participativo',
};
const commandNames: Record<string, string> = {
  'salvar-fila': 'salvar',
  'criar-playlist': 'criar',
  favoritas: 'favoritos',
  recentes: 'historico',
  'remover-musica': 'remover',
  'limpar-duplicadas': 'duplicadas',
  diagnostico: 'status',
};
const aliases: Record<string, string> = {
  remover: 'remove',
  fila: 'state',
  pausar: 'pause',
  continuar: 'resume',
  pular: 'skip',
  parar: 'stop',
  embaralhar: 'shuffle',
  duplicadas: 'deduplicate',
  favoritos: 'favorites',
  historico: 'history',
  playlists: 'playlists',
};
export function createMusicCommands({
  client,
  service,
  chat = () => undefined,
  diagnostics = () => ({}),
  now = Date.now,
}: {
  client: Client;
  service: PlayerService;
  chat?: () => ReturnType<typeof createChatHandler> | undefined;
  diagnostics?: () => Diagnostics;
  now?: () => number;
}) {
  const panels = new MusicPanels({ service });
  const pending = new Set<string>(),
    lastRequests = new Map<string, number>();
  async function choices(interaction: Interaction, action: string, page = 0) {
    const guild = interaction.guildId!,
      user = interaction.user.id;
    const state = await service.run(
      guild,
      user,
      ['remove', 'state'].includes(action) ? 'state' : action,
    );
    if (action === 'playlists') {
      const items = (state.playlists || []).map((list) => ({
        label: list.name,
        description: `${list.category} · ${list.count} música(s)`,
        value: list.id,
      }));
      return messagePayload(
        items.length
          ? 'Escolha uma playlist.'
          : 'Nenhuma playlist salva. Use /dam salvar-fila ou /dam criar-playlist.',
        selection('playlist', 'Escolher playlist', items, page),
      );
    }
    if (action === 'history' || action === 'favorites') {
      const items = (
        action === 'history' ? state.history || [] : state.favorites || []
      ).map((item) => ({
        label: item.track.title,
        description: item.track.artist,
        value: item.id,
      }));
      return messagePayload(
        items.length
          ? 'Escolha uma música para tocar.'
          : action === 'history'
            ? 'Histórico vazio.'
            : 'Você ainda não tem favoritas.',
        selection(action, 'Escolher música', items, page),
      );
    }
    const text = state.current
      ? `**${state.paused ? 'Pausada' : 'Tocando'}:** ${safeTitle(state.current.title)}\n${
          (state.queue || [])
            .slice(page * 20, page * 20 + 20)
            .map(
              (track, index) =>
                `${page * 20 + index + 1}. ${safeTitle(track.title, 35)}`,
            )
            .join('\n') || 'Nenhuma música na fila.'
        }`
      : 'Nenhuma música está tocando.';
    return messagePayload(
      text,
      selection(
        'remove',
        'Remover música da fila',
        (state.queue || []).map((track) => ({
          label: track.title,
          value: track.queueId!,
        })),
        page,
      ),
    );
  }
  async function handle(interaction: Interaction) {
    const command = interaction.isChatInputCommand();
    const slash = interaction as ChatInputCommandInteraction;
    const component = interaction.isButton() || interaction.isStringSelectMenu();
    if (command && !musicCommands.some((item) => item.name === slash.commandName))
      return;
    if (
      !command &&
      (!component ||
        !('customId' in interaction && interaction.customId.startsWith('dam:')))
    )
      return;
    if (
      !interaction.isChatInputCommand() &&
      !interaction.isButton() &&
      !interaction.isStringSelectMenu()
    )
      return;
    try {
      if (interaction.guildId !== MUSIC_GUILD_ID)
        throw new MusicError(403, 'Música disponível somente no servidor Amigos.');
      const user = interaction.user.id,
        guild = interaction.guildId!;
      if (
        pending.has(user) ||
        pending.size >= 20 ||
        now() - (lastRequests.get(user) ?? -Infinity) < 1500
      )
        throw new MusicError(429, 'Aguarde um instante antes do próximo comando.');
      pending.add(user);
      lastRequests.set(user, now());
      if (lastRequests.size > 500)
        lastRequests.delete(lastRequests.keys().next().value!);
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const requestedName = command
          ? slash.commandName === 'dam'
            ? slash.options.getSubcommand()
            : slash.commandName
          : ('customId' in interaction ? interaction.customId : '').slice(4);
        const name = commandNames[requestedName] || requestedName;
        const value = interaction.isStringSelectMenu()
          ? interaction.values[0]
          : undefined;
        let action = aliases[name] || name;
        if (name === 'ajuda')
          return await interaction.editReply(
            messagePayload(
              '**TheDam**\n`/dam tocar` nome ou link · `/dam painel` controles para o grupo\n`/dam playlists` listas por gênero · `/dam salvar-fila` guarda a fila\n`/dam favoritas` · `/dam recentes` · `/dam remover-musica`\n`/dam conversa` configura o Markov (administradores) · `/dam diagnostico`',
            ),
          );
        if (name === 'status') {
          const status = await service.run(guild, user, 'status');
          return await interaction.editReply(
            messagePayload(
              `**Estado do TheDam**\nDiscord: ${client.isReady?.() ? 'conectado' : 'reconectando'}\nComandos: ${status.commands === false ? 'indisponíveis' : 'disponíveis'}\nSpotify: ${status.spotify ? 'configurado' : 'não configurado'}\nMarkov: ${modeNames[chat()?.status().mode || ''] || status.markovReason || 'desativado'}\n${status.audioError ? 'Última falha: ' + status.audioError : 'Sem falha de áudio registrada.'}`,
            ),
          );
        }
        if (name === 'conversa') {
          const member = await client.guilds.cache.get(guild)?.members.fetch(user);
          if (!member?.permissions.has('ManageGuild'))
            throw new MusicError(403, 'É necessário Gerenciar Servidor.');
          const controller = chat();
          if (!controller)
            throw new MusicError(
              503,
              'Markov indisponível. Confira o Message Content Intent e /dam diagnostico.',
            );
          const mode = slash.options.getString('modo'),
            chaos = slash.options.getString('caos');
          const status = controller.configure(
            true,
            mode || undefined,
            chaos ? chaos === 'on' : undefined,
          );
          return await interaction.editReply(
            messagePayload(
              `Conversa: ${modeNames[status.mode] || status.mode}. Caos: ${status.chaos ? 'ativado' : 'desativado'}.`,
            ),
          );
        }
        if (name === 'tocar') {
          const query = slash.options.getString('musica', true);
          await interaction.editReply(messagePayload('Buscando música…'));
          const result = await service.run(guild, user, 'search', {
            query,
            provider: 'youtube',
          });
          if (!result.tracks?.length)
            throw new MusicError(
              404,
              'Não encontrei esta música. Tente outro nome ou link.',
            );
          if (!/^https?:\/\//i.test(query.trim()))
            return await interaction.editReply(
              messagePayload(
                'Escolha a versão que deseja tocar.',
                selection(
                  'track',
                  'Selecionar música',
                  result.tracks.map((track) => ({
                    label: track.title,
                    description: track.artist,
                    value: track.token,
                  })),
                ),
              ),
            );
          await interaction.editReply(
            messagePayload('Preparando áudio e conectando à call…'),
          );
          const state = await service.run(guild, user, 'enqueue', {
            token: result.tracks[0].token,
          });
          await panels.show(guild, interaction.channel as SendableChannels);
          return await interaction.editReply(
            messagePayload(
              `Adicionada: **${safeTitle(result.tracks[0].title)}**.${state.error ? ' ' + state.error : ''}`,
            ),
          );
        }
        if (name === 'track') {
          await interaction.editReply(
            messagePayload('Preparando áudio e conectando à call…'),
          );
          await service.run(guild, user, 'enqueue', { token: value });
          await panels.show(guild, interaction.channel as SendableChannels);
          return await interaction.editReply(
            messagePayload(
              'Música adicionada. O painel mostra a reprodução para o grupo.',
            ),
          );
        }
        if (name === 'page' || name.startsWith('page:')) {
          const [, type, page] = name.split(':');
          const categories: Record<string, string> = {
            playlist: 'playlists',
            history: 'history',
            favorites: 'favorites',
            remove: 'remove',
          };
          return await interaction.editReply(
            await choices(
              interaction,
              categories[type],
              Math.max(0, Number(page) || 0),
            ),
          );
        }
        if (
          ['state', 'remove', 'playlists', 'history', 'favorites'].includes(action) &&
          !value
        )
          return await interaction.editReply(await choices(interaction, action));
        if (name === 'playlist') {
          const lists = await service.run(guild, user, 'playlists');
          const list = (lists.playlists || []).find((item) => item.id === value);
          if (!list) throw new MusicError(404, 'Playlist não encontrada.');
          return await interaction.editReply(
            messagePayload(
              `**${safeTitle(list.name)}** · ${safeTitle(list.category)} · ${list.count} música(s)`,
              [
                row(
                  button('Adicionar à fila', 'playlistEnqueue:' + value, 1),
                  button('Salvar música atual aqui', 'addToPlaylist:' + value),
                  button('Excluir', 'deleteAsk:' + value, 4),
                ),
              ],
            ),
          );
        }
        if (name.startsWith('deleteAsk:'))
          return await interaction.editReply(
            messagePayload('Excluir esta playlist para o grupo?', [
              row(
                button('Confirmar exclusão', 'deletePlaylist:' + name.split(':')[1], 4),
                button('Cancelar', 'cancel'),
              ),
            ]),
          );
        if (name === 'cancel')
          return await interaction.editReply(messagePayload('Cancelado.'));
        let input: MusicInput = {};
        if (name === 'salvar' || name === 'criar') {
          action = name === 'salvar' ? 'savePlaylist' : 'createPlaylist';
          input = {
            name: slash.options.getString('nome', true),
            category: slash.options.getString('categoria') || '',
          };
        } else if (name === 'history' || name === 'favorites') {
          action = name === 'history' ? 'historyEnqueue' : 'favoriteEnqueue';
          input = { id: value };
        } else if (name === 'remove') input = { id: value };
        else if (name === 'repetir') {
          action = 'repeat';
          input = { enabled: slash.options.getString('modo') === 'on' };
        } else if (name.includes(':')) {
          const [operation, id] = name.split(':');
          if (
            !['playlistEnqueue', 'addToPlaylist', 'deletePlaylist'].includes(operation)
          )
            throw new MusicError(404, 'Ação não encontrada.');
          action = operation;
          input = { id };
        }
        if (name === 'painel') {
          await service.run(guild, user, 'state');
          await panels.show(guild, interaction.channel as SendableChannels);
          return await interaction.editReply(
            messagePayload('Painel disponível para o grupo neste canal.'),
          );
        }
        const result = await service.run(guild, user, action, input);
        if (
          ['enqueue', 'playlistEnqueue', 'historyEnqueue', 'favoriteEnqueue'].includes(
            action,
          )
        )
          await panels.show(guild, interaction.channel as SendableChannels);
        const messages: Record<string, string> = {
          pause: 'Música pausada.',
          resume: 'Reprodução retomada.',
          skip: result.current
            ? 'Tocando: **' + safeTitle(result.current.title) + '**.'
            : 'Fila encerrada.',
          stop: 'Fila encerrada. O bot saiu da call.',
          shuffle: 'Fila embaralhada.',
          deduplicate: 'Músicas duplicadas removidas.',
          repeat: input.enabled ? 'Repetição ativada.' : 'Repetição desativada.',
          favorite: 'Música salva nas suas favoritas.',
          savePlaylist: 'Playlist salva com a música atual e a fila.',
          createPlaylist: 'Playlist criada. Adicione músicas pelo menu de playlists.',
          addToPlaylist: 'Música adicionada à playlist.',
          deletePlaylist: 'Playlist excluída.',
          remove: 'Música removida da fila.',
        };
        await interaction.editReply(
          messagePayload(messages[action] || 'Música(s) adicionada(s) à fila.'),
        );
      } finally {
        pending.delete(user);
      }
    } catch (error) {
      const payload = messagePayload(
        error instanceof MusicError
          ? error.message
          : 'Não foi possível concluir. Tente novamente.',
      );
      try {
        if (interaction.deferred || interaction.replied)
          await interaction.editReply(payload);
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      } catch {
        console.warn('Não foi possível responder ao comando do TheDam.');
      }
    }
  }
  client.on('interactionCreate', handle);
  return {
    handle,
    close() {
      client.off('interactionCreate', handle);
      panels.close();
    },
  };
}
