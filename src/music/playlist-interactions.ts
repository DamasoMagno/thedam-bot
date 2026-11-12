import {
  playlistDetailPayload,
  playlistRemovePayload,
} from './playlist-presentation.ts';
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { PlayerService } from './player-service.ts';
import { spotifyPlaylistId } from './spotify-playlists.ts';
import { messagePayload, selection, safeTitle, row, button } from './presentation.ts';
import { MusicError } from '../shared/music-error.ts';

type PlaylistInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;
export function playlistInputModal(id: string) {
  return new ModalBuilder()
    .setCustomId('dam:playlistInput:' + id)
    .setTitle('Adicionar músicas')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('query')
          .setLabel('Nome ou link do YouTube/Spotify')
          .setPlaceholder('Música ou playlist do Spotify')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(240),
      ),
    );
}
export async function handlePlaylistInteraction(
  interaction: PlaylistInteraction,
  service: PlayerService,
  name: string,
) {
  const guild = interaction.guildId!,
    user = interaction.user.id;
  const [operation, listId, revision] = name.split(':');
  if (name.startsWith('page:playlistRemove:')) {
    const [, , id, expected, page] = name.split(':');
    const result = await service.run(guild, user, 'playlist', { id });
    if (result.playlist!.revision !== expected)
      throw new MusicError(409, 'A playlist mudou. Abra a lista novamente.');
    await interaction.editReply(
      playlistRemovePayload(result.playlist!, Math.max(0, Number(page) || 0)),
    );
    return true;
  }
  if (
    ['playlistOpen', 'playlistRemoveMenu', 'playlistRemove'].includes(operation) ||
    name === 'playlist'
  ) {
    const id =
      name === 'playlist' && interaction.isStringSelectMenu()
        ? interaction.values[0]
        : listId;
    const result =
      operation === 'playlistRemove' && interaction.isStringSelectMenu()
        ? await service.run(guild, user, 'playlistRemoveTrack', {
            id,
            position: Number(interaction.values[0]),
            revision,
          })
        : await service.run(guild, user, 'playlist', { id });
    await interaction.editReply(
      operation === 'playlistRemoveMenu'
        ? playlistRemovePayload(result.playlist!)
        : playlistDetailPayload(result.playlist!, result.canEdit !== false),
    );
    return true;
  }
  if (operation === 'libraryInput' && interaction.isModalSubmit()) {
    if (!['createPlaylist', 'importPlaylist', 'savePlaylist'].includes(listId))
      throw new MusicError(404, 'Ação não encontrada.');
    const result = await service.run(guild, user, listId, {
      name: interaction.fields.getTextInputValue('name') || undefined,
      category: interaction.fields.getTextInputValue('category') || undefined,
      query:
        listId === 'importPlaylist'
          ? interaction.fields.getTextInputValue('link')
          : undefined,
    });
    await interaction.editReply(
      playlistDetailPayload(result.playlist!, result.canEdit !== false),
    );
    return true;
  }
  const saved = async (id: string, token: string) => {
    const result = await service.run(guild, user, 'playlistAddTrack', { id, token });
    await interaction.editReply(
      messagePayload(`Música salva em **${safeTitle(result.playlist?.name)}**.`, [
        row(
          button('Adicionar mais', 'playlistAdd:' + id),
          button('Playlists', 'playlists'),
        ),
      ]),
    );
  };
  if (name.startsWith('playlistTrack:') && interaction.isStringSelectMenu()) {
    await saved(name.split(':')[1], interaction.values[0]);
    return true;
  }
  if (name !== 'importar-playlist' && !name.startsWith('playlistInput:')) return false;
  const query = interaction.isModalSubmit()
    ? interaction.fields.getTextInputValue('query')
    : interaction.isChatInputCommand()
      ? interaction.options.getString('link', true)
      : '';
  const id = name.startsWith('playlistInput:') ? name.split(':')[1] : undefined;
  if (name === 'importar-playlist' || spotifyPlaylistId(query)) {
    const result = await service.run(guild, user, 'importPlaylist', {
      id,
      query,
      name: interaction.isChatInputCommand()
        ? interaction.options.getString('nome') || undefined
        : undefined,
    });
    await interaction.editReply(
      messagePayload(
        `**${safeTitle(result.playlist?.name)}** salva com ${result.playlist?.tracks.length || 0} música(s).${result.skipped ? ` ${result.skipped} item(ns) indisponível(is), local(is) ou duplicado(s) ignorado(s).` : ''}`,
        [
          row(
            button('Adicionar à fila', 'playlistEnqueue:' + result.playlist?.id),
            button('Playlists', 'playlists'),
          ),
        ],
      ),
    );
    return true;
  }
  await interaction.editReply(messagePayload('Buscando música para salvar…'));
  const result = await service.run(guild, user, 'playlistSearch', {
    id,
    query,
    provider: 'youtube',
  });
  if (!result.tracks?.length)
    throw new MusicError(404, 'Não encontrei esta música. Tente outro nome ou link.');
  if (/^https?:\/\//iu.test(query.trim()) && result.tracks.length === 1) {
    await saved(id!, result.tracks[0].token);
    return true;
  }
  await interaction.editReply(
    messagePayload(
      'Escolha a versão para salvar na playlist.',
      selection(
        'playlistTrack:' + id,
        'Selecionar música',
        result.tracks.map((track) => ({
          label: track.title,
          description: track.artist,
          value: track.token,
        })),
      ),
    ),
  );
  return true;
}
