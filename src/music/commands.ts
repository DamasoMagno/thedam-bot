import type { LastFmService } from '../lastfm/service.ts';
import { handleLastFmInteraction } from '../lastfm/interactions.ts';
import type { VoiceController } from '../voice/controller.ts';
import { musicInputModal, libraryInputModal } from './input-modals.ts';
import { playlistListPayload } from './playlist-presentation.ts';
import {
  playlistInputModal,
  handlePlaylistInteraction,
} from './playlist-interactions.ts';
import { GENERAL_CHANNEL_ID } from '../config/constants.ts';
import type { ChatMessage } from '../chat/types.ts';
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
  queuePayload,
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
  musica: 'painel',
  musicInput: 'tocar',
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
  voice,
  lastfm,
}: {
  client: Client;
  service: PlayerService;
  chat?: () => ReturnType<typeof createChatHandler> | undefined;
  diagnostics?: () => Diagnostics;
  now?: () => number;
  voice?: VoiceController;
  lastfm?: LastFmService;
}) {
  const panels = new MusicPanels({
    service,
    voiceAvailable: Boolean(voice),
    lastfmAvailable: Boolean(lastfm),
  });
  const pending = new Set<string>(),
    lastRequests = new Map<string, number>();
  async function choices(interaction: Interaction, action: string, page = 0) {
    const guild = interaction.guildId!,
      user = interaction.user.id;
    const state = await service.run(
      guild,
      user,
      ['remove', 'state'].includes(action)
        ? 'state'
        : ['playPlaylist', 'saveCurrent'].includes(action)
          ? 'playlists'
          : action,
    );
    if (['playlists', 'playPlaylist', 'saveCurrent'].includes(action)) {
      const items = (state.playlists || []).map((list) => ({
        label: list.name,
        description: `${list.category} · ${list.count} música(s)`,
        value: list.id,
      }));
      if (action === 'saveCurrent')
        return messagePayload(
          'Escolha onde salvar a música atual.',
          selection('playlistSaveCurrent', 'Salvar na playlist', items, page),
        );
      return playlistListPayload(
        state.playlists || [],
        page,
        action === 'playPlaylist',
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
    return queuePayload(state, { page, removeOnly: action === 'remove' });
  }
  async function handle(interaction: Interaction) {
    const command = interaction.isChatInputCommand();
    const slash = interaction as ChatInputCommandInteraction;
    const component =
      interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit?.();
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
      !interaction.isStringSelectMenu() &&
      !interaction.isModalSubmit?.()
    )
      return;
    try {
      if (interaction.guildId !== MUSIC_GUILD_ID)
        throw new MusicError(403, 'Música disponível somente no servidor Amigos.');
      if (interaction.isButton() && interaction.customId === 'dam:voiceCancel') {
        if (!voice) throw new MusicError(503, 'Comando por voz indisponível.');
        await interaction.deferUpdate();
        voice.cancel(interaction.user.id);
        await interaction.editReply(
          messagePayload('Comando por voz cancelado. A captura foi encerrada.'),
        );
        return;
      }
      const privateNavigation =
        !command &&
        (interaction.isButton() ||
          interaction.isStringSelectMenu() ||
          (interaction.isModalSubmit?.() && interaction.isFromMessage?.())) &&
        Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral)) &&
        /^dam:(?:state$|queueTrack$|moveUp:|moveDown:|queueRemove:|page:|playlist|libraryInput:|playlists$|deleteAsk:|deletePlaylist:|cancel$|shuffle$|deduplicate$|repeatToggle$|stop$)/u.test(
          interaction.customId,
        );
      const user = interaction.user.id,
        guild = interaction.guildId!;
      if (
        pending.has(user) ||
        pending.size >= 20 ||
        now() - (lastRequests.get(user) ?? -Infinity) < (privateNavigation ? 300 : 1500)
      )
        throw new MusicError(429, 'Aguarde um instante antes do próximo comando.');
      pending.add(user);
      lastRequests.set(user, now());
      if (lastRequests.size > 500)
        lastRequests.delete(lastRequests.keys().next().value!);
      try {
        if (interaction.isButton()) {
          const id = interaction.customId.slice(4);
          if (id === 'addMusic') {
            await interaction.showModal(musicInputModal());
            return;
          }
          const libraryActions: Record<
            string,
            'createPlaylist' | 'importPlaylist' | 'savePlaylist'
          > = {
            playlistCreate: 'createPlaylist',
            playlistImport: 'importPlaylist',
            saveQueue: 'savePlaylist',
          };
          if (libraryActions[id]) {
            await interaction.showModal(libraryInputModal(libraryActions[id]));
            return;
          }
        }
        if (
          interaction.isButton() &&
          interaction.customId.startsWith('dam:playlistAdd:')
        ) {
          await interaction.showModal(
            playlistInputModal(interaction.customId.split(':')[2]),
          );
          return;
        }
        if (privateNavigation && !interaction.isChatInputCommand())
          await interaction.deferUpdate();
        else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const requestedName = command
          ? slash.commandName === 'dam'
            ? slash.options.getSubcommand()
            : slash.commandName
          : ('customId' in interaction ? interaction.customId : '').slice(4);
        let name = commandNames[requestedName] || requestedName;
        const value = interaction.isStringSelectMenu()
          ? interaction.values[0]
          : undefined;
        if (
          name === 'more' &&
          value &&
          [
            'favorite',
            'saveCurrent',
            'favorites',
            'history',
            'stop',
            'lastfm',
          ].includes(value)
        )
          name = value;
        let action = aliases[name] || name;
        if (await handleLastFmInteraction(interaction, name, value, service, lastfm))
          return;
        if (name === 'voiceCommand') {
          if (!voice)
            throw new MusicError(503, 'Comando por voz indisponível. Use /tocar.');
          await voice.begin(guild, user, (content, cancellable) =>
            interaction.editReply(
              messagePayload(
                content,
                cancellable ? [row(button('Cancelar escuta', 'voiceCancel', 4))] : [],
              ),
            ),
          );
          return;
        }
        if (await handlePlaylistInteraction(interaction, service, name)) return;
        if (name === 'ajuda')
          return await interaction.editReply(
            messagePayload(
              '**TheDam**\n`/musica` abre o painel · `/tocar` nome ou link\n`/playlists` cria, importa e organiza listas · `/fila` organiza as próximas músicas\n`/pausar` · `/continuar` · `/pular` · `/parar`\n`/dam frase` · `/dam perolas` · `/dam perola-da-semana`\n`/dam conversa` configura o Markov (administradores) · `/dam diagnostico`',
            ),
          );
        if (['frase', 'perolas', 'perola-da-semana', 'quote'].includes(name)) {
          if (interaction.channelId !== GENERAL_CHANNEL_ID)
            throw new MusicError(
              403,
              'Use os comandos de conversa no geral do Amigos.',
            );
          const controller = chat();
          if (!controller)
            throw new MusicError(503, 'Conversa indisponível. Veja /dam diagnostico.');
          if (name === 'perolas') {
            const entries = controller.pearls();
            return await interaction.editReply(
              messagePayload(
                entries.length
                  ? 'Escolha uma pérola para publicar no geral.'
                  : 'Ainda não há pérolas. Reaja com 👍 às frases do bot.',
                selection(
                  'quote',
                  'Escolher pérola',
                  entries.map((entry) => ({ label: entry.text, value: entry.id })),
                ),
              ),
            );
          }
          const content =
            name === 'frase'
              ? slash.options.getString('palavra') || ''
              : name === 'perola-da-semana'
                ? controller.weeklyPearl()?.text
                : controller.pearls().find((entry) => entry.id === value)?.text;
          if (content === undefined || content === null)
            throw new MusicError(
              404,
              'Ainda não há uma pérola com avaliações nesta semana.',
            );
          const message = {
            id: '',
            guildId: guild,
            channelId: interaction.channelId!,
            content,
            author: { id: user },
            channel: interaction.channel,
          } as ChatMessage;
          if (name === 'frase') await controller.requestPhrase(message, content);
          else await controller.requestQuote(message, content);
          return await interaction.editReply(
            messagePayload('Vou publicar a resposta no geral.'),
          );
        }
        if (name === 'status') {
          const status = await service.run(guild, user, 'status');
          return await interaction.editReply(
            messagePayload(
              `**Estado do TheDam**\nDiscord: ${client.isReady?.() ? 'conectado' : 'reconectando'}\nComandos: ${status.commands === false ? 'indisponíveis' : 'disponíveis'}\nSpotify: ${status.spotify ? 'configurado' : 'não configurado'}\nMarkov: ${modeNames[chat()?.status().mode || ''] || status.markovReason || 'desativado'}\nIA: ${chat()?.status().ai?.status || 'desativada'}\n${status.search ? `Busca: ${status.search.lastDurationMs} ms · ${status.search.hits} reaproveitada(s)\n` : ''}${status.audioStartupMs !== undefined ? `Primeiro áudio: ${status.audioStartupMs} ms\n` : ''}${status.audioError ? 'Última falha: ' + status.audioError : 'Sem falha de áudio registrada.'}`,
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
          const query = interaction.isModalSubmit?.()
            ? interaction.fields.getTextInputValue('query')
            : slash.options.getString('musica', true);
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
        if (name === 'playPlaylist' && value) {
          await service.run(guild, user, 'playlistEnqueue', { id: value });
          await panels.show(guild, interaction.channel as SendableChannels);
          return await interaction.editReply(
            messagePayload('Playlist adicionada à fila da call.'),
          );
        }
        if (name === 'quickPlaylists' || name === 'saveCurrent')
          return await interaction.editReply(
            await choices(
              interaction,
              name === 'saveCurrent' ? 'saveCurrent' : 'playPlaylist',
            ),
          );
        if (name === 'playlistSaveCurrent') {
          const result = await service.run(guild, user, 'addToPlaylist', { id: value });
          return await interaction.editReply(
            messagePayload(
              'Música atual salva em **' + safeTitle(result.playlist?.name) + '**.',
            ),
          );
        }
        if (name === 'repeatToggle') {
          const state = await service.run(guild, user, 'state');
          const result = await service.run(guild, user, 'repeat', {
            enabled: !state.repeat,
          });
          return await interaction.editReply(queuePayload(result));
        }
        if (['shuffle', 'deduplicate'].includes(name)) {
          const result = await service.run(guild, user, name);
          return await interaction.editReply(queuePayload(result));
        }
        if (name === 'page' || name.startsWith('page:')) {
          const [, type, page] = name.split(':');
          const categories: Record<string, string> = {
            playlist: 'playlists',
            history: 'history',
            favorites: 'favorites',
            remove: 'remove',
            queueTrack: 'state',
            playPlaylist: 'playPlaylist',
            playlistSaveCurrent: 'saveCurrent',
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
        if (name === 'queueTrack' || /^(moveUp|moveDown|queueRemove):/u.test(name)) {
          const [operation, id] = name.split(':');
          if (operation === 'queueRemove') {
            await service.run(guild, user, 'remove', { id });
            return await interaction.editReply(await choices(interaction, 'state'));
          }
          const state =
            name === 'queueTrack'
              ? await service.run(guild, user, 'state')
              : await service.run(guild, user, 'move', {
                  id,
                  direction: operation === 'moveUp' ? 'up' : 'down',
                });
          return await interaction.editReply(
            queuePayload(state, { selectedId: name === 'queueTrack' ? value : id }),
          );
        }
        if (name.startsWith('deleteAsk:'))
          return await interaction.editReply(
            messagePayload('Excluir esta playlist para o grupo?', [
              row(
                button('Confirmar exclusão', 'deletePlaylist:' + name.split(':')[1], 4),
                button('Cancelar', 'playlistOpen:' + name.split(':')[1]),
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
        if (action === 'deletePlaylist') {
          const payload = await choices(interaction, 'playlists');
          payload.content = 'Playlist excluída.\n' + payload.content;
          return await interaction.editReply(payload);
        }
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
