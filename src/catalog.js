import { execFile } from 'node:child_process';
import { MusicError } from './error.js';

export const youtubeId = (value) => /^[A-Za-z0-9_-]{11}$/.test(value || '');
export function parseQuery(value, provider = 'youtube') {
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
  if (youtubeId(video)) return { provider: 'youtube', video };
  const spotify =
    host === 'open.spotify.com' &&
    /^\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
  if (spotify) return { provider: 'spotify', track: spotify[1] };
  throw new MusicError(
    400,
    'Use um link de música do YouTube ou Spotify. Playlists ainda não são aceitas.',
  );
}
export function runExtractor(binary, args) {
  return new Promise((resolve, reject) =>
    execFile(
      binary,
      [
        '--ignore-config',
        '--no-warnings',
        '--no-cache-dir',
        '--js-runtimes',
        'node',
        ...args,
      ],
      { timeout: 25000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error)
          return reject(
            new MusicError(502, 'Não foi possível consultar o YouTube agora.'),
          );
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new MusicError(502, 'Resposta de busca inválida.'));
        }
      },
    ),
  );
}
export class Catalog {
  constructor(config, { extract = runExtractor, fetchImpl = fetch } = {}) {
    Object.assign(this, { config, extract, fetch: fetchImpl });
    this.token = null;
  }
  async spotifyToken() {
    if (!this.config.spotifyId || !this.config.spotifySecret)
      throw new MusicError(
        503,
        'A busca no Spotify precisa ser configurada pelo administrador.',
      );
    if (this.token?.until > Date.now()) return this.token.value;
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
  async search(query, provider) {
    const parsed = parseQuery(query, provider);
    if (parsed.provider === 'spotify') {
      const token = await this.spotifyToken();
      const path = parsed.track
        ? '/tracks/' + parsed.track
        : '/search?' +
          new URLSearchParams({ q: parsed.query, type: 'track', limit: '5' });
      const response = await this.fetch('https://api.spotify.com/v1' + path, {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        if (response.status === 401) this.token = null;
        throw new MusicError(502, 'Não foi possível buscar músicas no Spotify.');
      }
      const data = await response.json();
      return (parsed.track ? [data] : data.tracks?.items || [])
        .filter((t) => t?.id && t.name)
        .map((t) => ({
          provider: 'spotify',
          id: t.id,
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(', '),
          duration: Math.round(t.duration_ms / 1000),
        }));
    }
    const target = parsed.video
      ? 'https://www.youtube.com/watch?v=' + parsed.video
      : 'ytsearch5:' + parsed.query;
    const data = await this.extract(this.config.ytdlp, [
      '--dump-single-json',
      '--flat-playlist',
      '--no-playlist',
      '--',
      target,
    ]);
    return (data.entries || [data])
      .filter((t) => youtubeId(t.id))
      .slice(0, 5)
      .map((t) => ({
        provider: 'youtube',
        id: t.id,
        title: String(t.title || 'Música').slice(0, 200),
        artist: String(t.channel || t.uploader || '').slice(0, 160),
        duration: Number.isFinite(t.duration) ? Math.round(t.duration) : null,
      }));
  }
  async playable(track) {
    if (track.provider === 'youtube') return track;
    const matches = await this.search(
      track.artist + ' ' + track.title + ' official audio',
      'youtube',
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
