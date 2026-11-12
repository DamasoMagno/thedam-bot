import type { Track } from './types.ts';
import { MusicError } from '../shared/music-error.ts';

export function spotifyPlaylistId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'open.spotify.com' ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    return (
      /^\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]{22})\/?$/u.exec(url.pathname)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}

export class SpotifyPlaylists {
  private token: { value: string; expiresAt: number } | null = null;
  private credentials: { id: string; secret: string; refreshToken?: string };
  private fetch: typeof fetch;
  constructor(
    credentials: { id: string; secret: string; refreshToken?: string },
    fetchImpl: typeof fetch = fetch,
  ) {
    this.credentials = credentials;
    this.fetch = fetchImpl;
  }
  private async userToken(signal?: AbortSignal) {
    if (
      !this.credentials.id ||
      !this.credentials.secret ||
      !this.credentials.refreshToken
    )
      throw new MusicError(
        503,
        'Conecte uma conta Spotify com npm run spotify:connect para importar playlists.',
      );
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const response = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(this.credentials.id + ':' + this.credentials.secret).toString(
            'base64',
          ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refreshToken,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new MusicError(
        502,
        'Reconecte a conta Spotify com npm run spotify:connect.',
      );
    const data = await response.json();
    if (typeof data.access_token !== 'string')
      throw new MusicError(502, 'Resposta inválida do Spotify.');
    if (typeof data.refresh_token === 'string')
      this.credentials.refreshToken = data.refresh_token;
    this.token = {
      value: data.access_token,
      expiresAt:
        Date.now() +
        Math.max(0, Math.min(Number(data.expires_in) || 3600, 3600) - 60) * 1000,
    };
    return this.token.value;
  }
  async import(
    query: unknown,
    signal?: AbortSignal,
  ): Promise<{ name: string; tracks: Track[]; skipped: number }> {
    const id = spotifyPlaylistId(query);
    if (!id)
      throw new MusicError(400, 'Use o link completo de uma playlist do Spotify.');
    const token = await this.userToken(signal);
    const request = async (path: string) => {
      const response = await this.fetch('https://api.spotify.com/v1' + path, {
        headers: { Authorization: 'Bearer ' + token },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      });
      if ([401, 403, 404].includes(response.status)) {
        if (response.status === 401) this.token = null;
        throw new MusicError(
          response.status === 401 ? 503 : 403,
          'O Spotify não liberou esta playlist. Use uma lista da conta conectada ou em que ela seja colaboradora.',
        );
      }
      if (response.status === 429)
        throw new MusicError(
          429,
          'O Spotify pediu uma pausa. Aguarde antes de importar novamente.',
        );
      if (!response.ok)
        throw new MusicError(
          502,
          'Não foi possível importar a playlist do Spotify agora.',
        );
      return response.json();
    };
    const details = await request('/playlists/' + id);
    const tracks: Track[] = [];
    const seen = new Set<string>();
    let skipped = 0,
      offset = 0;
    for (let page = 0; page < 20; page++) {
      const data = await request(
        `/playlists/${id}/items?limit=50&offset=${offset}&market=BR`,
      );
      if (!Array.isArray(data.items))
        throw new MusicError(502, 'O Spotify não retornou o conteúdo da playlist.');
      for (const entry of data.items) {
        const track = entry?.item ?? entry?.track;
        if (
          entry?.is_local ||
          track?.is_local ||
          (track?.type && track.type !== 'track') ||
          !/^[a-zA-Z0-9]{22}$/u.test(track?.id || '') ||
          typeof track?.name !== 'string' ||
          track?.is_playable === false
        ) {
          skipped++;
          continue;
        }
        if (seen.has(track.id)) {
          skipped++;
          continue;
        }
        seen.add(track.id);
        tracks.push({
          provider: 'spotify',
          id: track.id,
          title: track.name,
          artist: (track.artists || [])
            .map((artist: { name: string }) => artist.name)
            .join(', '),
          duration: Number.isFinite(track.duration_ms)
            ? Math.round(track.duration_ms / 1000)
            : null,
        });
        if (tracks.length > 50)
          throw new MusicError(
            409,
            'Esta playlist tem mais de 50 músicas. Crie uma lista menor no Spotify para importar. Nada foi salvo.',
          );
      }
      if (!data.next) {
        if (!tracks.length)
          throw new MusicError(
            409,
            'Esta playlist não tem músicas compatíveis para importar.',
          );
        return {
          name: String(details.name || 'Spotify').slice(0, 60),
          tracks,
          skipped,
        };
      }
      if (!data.items.length)
        throw new MusicError(
          502,
          'A paginação da playlist retornou vazia. Nada foi salvo.',
        );
      offset += data.items.length;
    }
    throw new MusicError(
      409,
      'A playlist é grande demais para importar. Nada foi salvo.',
    );
  }
}
