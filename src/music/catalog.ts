import { createYoutubeSession } from './youtube-session.ts';
import { youtubeError } from './youtube-error.ts';
import {
  AudioLocationCache,
  trustedAudioLocation,
  type AudioFormat,
} from './audio-location-cache.ts';
import { SpotifyPlaylists } from './spotify-playlists.ts';
import { SearchCache } from './search-cache.ts';
import type { Track } from './types.ts';
import type { configuration } from '../config/index.ts';
type Config = ReturnType<typeof configuration>;
interface ExtractedTrack extends AudioFormat {
  id: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  url?: string;
  http_headers?: Record<string, string>;
}
interface ExtractedResult extends Partial<ExtractedTrack> {
  entries?: ExtractedTrack[];
}
interface SpotifyTrack {
  id: string;
  name: string;
  artists?: { name: string }[];
  duration_ms: number;
}
import { execFile } from 'node:child_process';
import { MusicError } from '../shared/music-error.ts';

export const youtubeId = (value: unknown) =>
  /^[A-Za-z0-9_-]{11}$/.test(typeof value === 'string' ? value : '');
export function parseQuery(value: unknown, provider = 'youtube') {
  if (
    !['youtube', 'spotify'].includes(provider) ||
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 240
  )
    throw new MusicError(400, 'Informe um nome ou link válido.');
  const query = value.trim();
  if (!/^https?:\/\//i.test(query)) return { provider, query };
  let url;
  try {
    url = new URL(query);
  } catch {
    throw new MusicError(400, 'Link inválido.');
  }
  if (url.username || url.password || url.port)
    throw new MusicError(400, 'Link inválido.');
  const host = url.hostname.toLowerCase();
  const video =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : [
            'www.youtube.com',
            'youtube.com',
            'm.youtube.com',
            'music.youtube.com',
          ].includes(host)
        ? url.searchParams.get('v') ||
          /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
        : null;
  if (youtubeId(video)) return { provider: 'youtube' as const, video };
  const spotify =
    host === 'open.spotify.com' &&
    /^\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
  if (spotify) return { provider: 'spotify' as const, track: spotify[1] };
  throw new MusicError(
    400,
    'Use um link de música do YouTube ou Spotify. Playlists ainda não são aceitas.',
  );
}
export function runExtractor(
  binary: string,
  args: string[],
  { signal, cookiesFile }: { signal?: AbortSignal; cookiesFile?: string } = {},
): Promise<ExtractedResult> {
  signal?.throwIfAborted();
  const session = createYoutubeSession(cookiesFile);
  return new Promise<ExtractedResult>((resolve, reject) =>
    execFile(
      binary,
      [
        '--ignore-config',
        '--compat-options',
        'prefer-legacy-http-handler',
        '--no-warnings',
        '--no-cache-dir',
        '--js-runtimes',
        'node',
        ...session.args,
        ...args,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024, windowsHide: true, signal },
      (error, stdout, stderr) => {
        if (signal?.aborted) return reject(signal.reason);
        if (error)
          return reject(youtubeError(String(stderr).slice(-8192) + ' ' + error.code));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new MusicError(502, 'Resposta de busca inválida.'));
        }
      },
    ),
  ).finally(() => session.close());
}
export class Catalog {
  private cache: SearchCache;
  private audioLocations = new AudioLocationCache();
  private playlists: SpotifyPlaylists;
  private searches = { hits: 0, misses: 0, lastDurationMs: 0 };
  config!: Config;
  extract!: typeof runExtractor;
  fetch!: typeof fetch;
  token: { until: number; value: string } | null;
  constructor(
    config: Config,
    { extract = runExtractor, fetchImpl = fetch, cache = new SearchCache() } = {},
  ) {
    Object.assign(this, { config, extract, fetch: fetchImpl });
    this.token = null;
    this.cache = cache;
    this.playlists = new SpotifyPlaylists(
      {
        id: config.spotifyId,
        secret: config.spotifySecret,
        refreshToken: config.spotifyRefreshToken,
      },
      fetchImpl,
    );
  }
  async spotifyToken() {
    if (!this.config.spotifyId || !this.config.spotifySecret)
      throw new MusicError(
        503,
        'A busca no Spotify precisa ser configurada pelo administrador.',
      );
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const response = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(this.config.spotifyId + ':' + this.config.spotifySecret).toString(
            'base64',
          ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new MusicError(502, 'Não foi possível acessar o Spotify.');
    const data = await response.json();
    if (!data.access_token) throw new MusicError(502, 'Resposta inválida do Spotify.');
    this.token = {
      value: data.access_token,
      until: Date.now() + (Math.min(data.expires_in || 3600, 3600) - 60) * 1000,
    };
    return this.token.value;
  }
  importPlaylist(query: unknown, { signal }: { signal?: AbortSignal } = {}) {
    return this.playlists.import(query, signal);
  }
  searchStatus() {
    return { ...this.searches, entries: this.cache.size };
  }
  async search(
    query: unknown,
    provider?: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<Track[]> {
    signal?.throwIfAborted();
    const parsed = parseQuery(query, provider);
    const key = JSON.stringify([
      parsed.provider,
      parsed.video ||
        parsed.track ||
        parsed.query?.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' '),
    ]);
    const start = performance.now();
    const cached = this.cache.get(key);
    if (cached) {
      this.searches.hits++;
      this.searches.lastDurationMs = Math.round(performance.now() - start);
      return cached;
    }
    this.searches.misses++;
    try {
      const tracks = await this.searchUncached(query, provider, { signal });
      signal?.throwIfAborted();
      this.cache.set(key, tracks);
      return tracks;
    } finally {
      this.searches.lastDurationMs = Math.round(performance.now() - start);
    }
  }
  private async searchUncached(
    query: unknown,
    provider?: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<Track[]> {
    const parsed = parseQuery(query, provider);
    if (parsed.provider === 'spotify') {
      const token = await this.spotifyToken();
      const path = parsed.track
        ? '/tracks/' + parsed.track
        : '/search?' +
          new URLSearchParams({ q: parsed.query || '', type: 'track', limit: '5' });
      const response = await this.fetch('https://api.spotify.com/v1' + path, {
        headers: { Authorization: 'Bearer ' + token },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
          : AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        if (response.status === 401) this.token = null;
        throw new MusicError(502, 'Não foi possível buscar músicas no Spotify.');
      }
      const data = await response.json();
      return (parsed.track ? [data] : data.tracks?.items || [])
        .filter((t: SpotifyTrack) => t?.id && t.name)
        .map((t: SpotifyTrack) => ({
          provider: 'spotify' as const,
          id: t.id,
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(', '),
          duration: Math.round(t.duration_ms / 1000),
        }));
    }
    const target = parsed.video
      ? 'https://www.youtube.com/watch?v=' + parsed.video
      : 'ytsearch5:' + parsed.query;
    const data = await this.extract(
      this.config.ytdlp,
      [
        '--dump-single-json',
        ...(parsed.video
          ? ['-f', 'bestaudio/best', '--skip-download']
          : ['--flat-playlist']),
        '--no-playlist',
        '--',
        target,
      ],
      { signal, cookiesFile: this.config.youtubeCookiesFile },
    );
    if (parsed.video && data.id === parsed.video) {
      const location = trustedAudioLocation(data.url, data.http_headers, data);
      if (location) this.audioLocations.set(parsed.video, location);
    }
    return (data.entries || [data])
      .filter((t): t is ExtractedTrack => youtubeId(t.id))
      .slice(0, 5)
      .map((t) => ({
        provider: 'youtube' as const,
        id: t.id,
        title: String(t.title || 'Música').slice(0, 200),
        artist: String(t.channel || t.uploader || '').slice(0, 160),
        duration: Number.isFinite(t.duration) ? Math.round(t.duration!) : null,
      }));
  }
  async audioLocation(track: Track, { signal }: { signal?: AbortSignal } = {}) {
    signal?.throwIfAborted();
    if (track.provider !== 'youtube' || !youtubeId(track.id))
      throw new MusicError(400, 'Música inválida.');
    const cached = this.audioLocations.get(track.id);
    if (cached) return cached;
    const data = await this.extract(
      this.config.ytdlp,
      [
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '-f',
        'bestaudio/best',
        '--',
        'https://www.youtube.com/watch?v=' + track.id,
      ],
      { signal, cookiesFile: this.config.youtubeCookiesFile },
    );
    signal?.throwIfAborted();
    const location =
      data.id === track.id
        ? trustedAudioLocation(data.url, data.http_headers, data)
        : null;
    if (!location)
      throw new MusicError(502, 'Não foi possível obter uma fonte segura de áudio.');
    this.audioLocations.set(track.id, location);
    return location;
  }
  invalidateAudio(id: string) {
    this.audioLocations.delete(id);
  }
  async playable(track: Track, options: { signal?: AbortSignal } = {}): Promise<Track> {
    if (track.provider === 'youtube') return track;
    const matches = await this.search(
      track.artist + ' ' + track.title + ' official audio',
      'youtube',
      options,
    );
    if (!matches.length)
      throw new MusicError(404, 'Não encontrei uma versão desta música no YouTube.');
    return {
      ...matches[0],
      requestedTitle: track.title,
      requestedArtist: track.artist,
    };
  }
}
