import { randomUUID } from 'node:crypto';
import { LastFmClient, LastFmError } from './client.ts';
import { LastFmRepository } from './repository.ts';
import type { Scrobble } from './repository.ts';
import { lastFmMetadata } from './metadata.ts';
import type { TrackView } from '../music/types.ts';
import { MusicError } from '../shared/music-error.ts';
export interface Recommendation {
  artist: string;
  track: string;
}
export class LastFmService {
  private client: LastFmClient;
  repository: LastFmRepository;
  private pending = new Map<string, { id: string; token?: string; expires: number }>();
  private choices = new Map<
    string,
    { user: string; item: Recommendation; expires: number }
  >();
  private cache = new Map<string, { items: Recommendation[]; expires: number }>();
  private accountListeners = new Set<(user: string) => void>();
  onAccountChange(listener: (user: string) => void) {
    this.accountListeners.add(listener);
    return () => this.accountListeners.delete(listener);
  }
  private accountChanged(user: string) {
    for (const listener of this.accountListeners) listener(user);
  }
  private flushing = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval>;
  constructor(client: LastFmClient, repository: LastFmRepository) {
    this.client = client;
    this.repository = repository;
    this.timer = setInterval(() => {
      void this.flush();
    }, 60000);
    this.timer.unref();
  }
  async connect(user: string) {
    const request = {
      id: randomUUID(),
      token: undefined as string | undefined,
      expires: Date.now() + 600000,
    };
    this.pending.delete(user);
    for (const [key, value] of this.pending)
      if (value.expires < Date.now()) this.pending.delete(key);
    if (this.pending.size >= 100)
      throw new MusicError(429, 'Aguarde para conectar ao Last.fm.');
    this.pending.set(user, request);
    const data = await this.client.request('auth.getToken');
    if (this.closed || this.pending.get(user) !== request)
      throw new MusicError(409, 'Autorização cancelada.');
    if (typeof data.token !== 'string' || !data.token) throw new LastFmError(11);
    request.token = data.token;
    return { id: request.id, url: this.client.authorizationUrl(data.token) };
  }
  async confirm(user: string, id: string) {
    const pending = this.pending.get(user);
    if (!pending?.token || pending.id !== id || pending.expires < Date.now())
      throw new MusicError(409, 'Este vínculo expirou. Clique em Conectar novamente.');
    const data = await this.client.request(
      'auth.getSession',
      { token: pending.token },
      true,
    );
    if (this.closed || this.pending.get(user) !== pending)
      throw new MusicError(409, 'Autorização cancelada.');
    if (typeof data.session?.name !== 'string' || typeof data.session?.key !== 'string')
      throw new LastFmError(11);
    this.pending.delete(user);
    this.repository.save(user, data.session.name, data.session.key);
    this.accountChanged(user);
    return data.session.name as string;
  }
  cancelConnect(user: string) {
    this.pending.delete(user);
  }
  unlink(user: string) {
    this.pending.delete(user);
    for (const [key, value] of this.choices)
      if (value.user === user) this.choices.delete(key);
    this.repository.remove(user);
    this.accountChanged(user);
  }
  async profile(user: string) {
    const account = this.repository.account(user);
    if (!account) return null;
    const result = await this.client.request('user.getInfo', { user: account.name });
    return { name: account.name, plays: Number(result.user?.playcount) || 0 };
  }
  async recommendations(user: string, current: TrackView | null, artists = false) {
    const account = this.repository.account(user);
    let seed = lastFmMetadata(current);
    if (!seed && account) {
      const top = await this.client.request('user.getTopTracks', {
        user: account.name,
        period: '1month',
        limit: '1',
      });
      const item = top.toptracks?.track?.[0];
      if (item?.artist?.name && item?.name)
        seed = { artist: item.artist.name, track: item.name, duration: 0 };
    }
    if (!seed)
      throw new MusicError(
        409,
        'Toque uma faixa com artista identificado ou conecte seu perfil Last.fm.',
      );
    const key = JSON.stringify([seed.artist, seed.track, artists]);
    const cached = this.cache.get(key);
    let items: Recommendation[];
    if (cached && cached.expires > Date.now()) items = cached.items;
    else {
      if (artists) {
        const similar = await this.client.request('artist.getSimilar', {
          artist: seed.artist,
          limit: '3',
          autocorrect: '1',
        });
        items = [];
        for (const artist of (similar.similarartists?.artist || []).slice(0, 3)) {
          if (typeof artist.name !== 'string') continue;
          const data = await this.client.request('artist.getTopTracks', {
            artist: artist.name,
            limit: '3',
            autocorrect: '1',
          });
          for (const item of (data.toptracks?.track || []).slice(0, 3))
            if (typeof item.name === 'string')
              items.push({ artist: artist.name, track: item.name });
        }
      } else {
        const data = await this.client.request('track.getSimilar', {
          artist: seed.artist,
          track: seed.track,
          limit: '10',
          autocorrect: '1',
        });
        items = (data.similartracks?.track || [])
          .slice(0, 10)
          .flatMap((item) =>
            typeof item.name === 'string' && typeof item.artist?.name === 'string'
              ? [{ artist: item.artist.name, track: item.name }]
              : [],
          );
      }
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { items, expires: Date.now() + 600000 });
    }
    for (const [key, value] of this.choices)
      if (value.expires < Date.now()) this.choices.delete(key);
    return items.map((item) => {
      if (this.choices.size >= 500)
        this.choices.delete(this.choices.keys().next().value!);
      const token = randomUUID();
      this.choices.set(token, { user, item, expires: Date.now() + 300000 });
      return { ...item, token };
    });
  }
  choice(user: string, token: string) {
    const choice = this.choices.get(token);
    if (!choice || choice.user !== user || choice.expires < Date.now())
      throw new MusicError(409, 'Sugestão expirada. Abra as recomendações novamente.');
    return choice.item;
  }
  async nowPlaying(user: string, item: Scrobble) {
    const account = this.repository.account(user);
    if (!account || this.closed) return;
    try {
      await this.client.request(
        'track.updateNowPlaying',
        {
          sk: account.session,
          artist: item.artist,
          track: item.track,
          duration: String(item.duration),
        },
        true,
      );
    } catch (error) {
      if (!this.closed && error instanceof LastFmError && error.code === 9)
        this.unlink(user);
    }
  }
  async flush() {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    try {
      for (const entry of this.repository.due()) {
        if (this.closed) break;
        const account = this.repository.account(entry.user);
        if (!account) continue;
        try {
          const result = await this.client.request(
            'track.scrobble',
            {
              sk: account.session,
              artist: entry.payload.artist,
              track: entry.payload.track,
              duration: String(entry.payload.duration),
              timestamp: String(entry.payload.timestamp),
              chosenByUser: entry.payload.chosenByUser,
            },
            true,
          );
          if (this.closed) break;
          // Explicit API rejections are terminal; transient HTTP/API failures retry.
          if (!result.scrobbles) throw new LastFmError(11);
          this.repository.complete(entry.id);
        } catch (error) {
          if (this.closed) break;
          if (error instanceof LastFmError && error.code === 9) this.unlink(entry.user);
          else if (error instanceof LastFmError && ![11, 16, 29].includes(error.code))
            this.repository.complete(entry.id);
          else this.repository.retry(entry.id, entry.attempts + 1);
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  close() {
    this.closed = true;
    this.client.close?.();
    clearInterval(this.timer);
    this.accountListeners.clear();
    this.pending.clear();
    this.choices.clear();
    this.cache.clear();
  }
}
