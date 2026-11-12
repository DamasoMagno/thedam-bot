import type { Playlist, PlaylistSummary } from './types.ts';
import { messagePayload, selection, row, button, safeTitle } from './presentation.ts';

export function playlistListPayload(lists: PlaylistSummary[], page = 0, play = false) {
  return messagePayload(
    lists.length
      ? play
        ? 'Escolha uma playlist para tocar na call.'
        : 'Escolha uma playlist para ver e organizar.'
      : 'Crie sua primeira playlist ou importe uma do Spotify.',
    [
      ...selection(
        play ? 'playPlaylist' : 'playlist',
        play ? 'Tocar playlist' : 'Escolher playlist',
        lists.map((list) => ({
          label: list.name,
          description: `${list.category} · ${list.count} música(s)`,
          value: list.id,
        })),
        page,
      ),
      row(
        button('Criar playlist', 'playlistCreate'),
        button('Importar Spotify', 'playlistImport'),
        button(
          play ? 'Gerenciar playlists' : 'Tocar uma playlist',
          play ? 'playlists' : 'quickPlaylists',
        ),
      ),
    ],
  );
}
export function playlistDetailPayload(list: Playlist, editable = true) {
  return messagePayload(
    `**${safeTitle(list.name)}** · ${list.tracks.length} música(s)\n${
      list.tracks
        .slice(0, 10)
        .map((track, index) => `${index + 1}. ${safeTitle(track.title, 40)}`)
        .join('\n') || 'Playlist vazia.'
    }${list.tracks.length > 10 ? '\nE mais ' + (list.tracks.length - 10) + ' música(s).' : ''}`,
    [
      row(
        button('Tocar', 'playlistEnqueue:' + list.id, 1, !list.tracks.length),
        button('Adicionar músicas', 'playlistAdd:' + list.id, 2, !editable),
        button(
          'Remover música',
          'playlistRemoveMenu:' + list.id,
          2,
          !list.tracks.length || !editable,
        ),
        button('Excluir playlist', 'deleteAsk:' + list.id, 4, !editable),
      ),
      row(button('Voltar', 'playlists')),
    ],
  );
}
export function playlistRemovePayload(list: Playlist, page = 0) {
  return messagePayload(
    `**${safeTitle(list.name)}**\nEscolha a música para remover da playlist.`,
    [
      ...selection(
        `playlistRemove:${list.id}:${list.revision}`,
        'Remover música da playlist',
        list.tracks.map((track, index) => ({
          label: `${index + 1}. ${track.title}`,
          description: track.artist,
          value: String(index),
        })),
        page,
      ),
      row(button('Voltar à playlist', 'playlistOpen:' + list.id)),
    ],
  );
}
