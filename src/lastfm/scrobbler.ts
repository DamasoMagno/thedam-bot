import { lastFmMetadata } from './metadata.ts';
import type { LastFmService } from './service.ts';
import type { MusicState } from '../music/types.ts';
interface Listener {
  heard: number;
  timestamp: number;
  sent: boolean;
}
export class LastFmScrobbler {
  private service: LastFmService;
  private previous?: { state: MusicState; audience: Set<string>; at: number };
  private listeners = new Map<string, Listener>();
  private unsubscribe: () => void;
  close() {
    this.unsubscribe();
    this.listeners.clear();
    this.previous = undefined;
  }
  constructor(service: LastFmService) {
    this.service = service;
    this.unsubscribe = service.onAccountChange((user) => this.listeners.delete(user));
  }
  update(state: MusicState, audience: Set<string>, now = Date.now()) {
    const previous = this.previous;
    const linked = new Set(this.service.repository.users());
    if (previous) {
      const metadata = lastFmMetadata(previous.state.current);
      const elapsed = Math.max(0, Math.min(20000, now - previous.at));
      if (
        metadata &&
        metadata.duration > 30 &&
        previous.state.playbackActive &&
        !previous.state.paused
      ) {
        for (const user of previous.audience) {
          if (!linked.has(user)) continue;
          const listener = this.listeners.get(user);
          if (!listener) continue;
          listener.heard += elapsed;
          if (
            !listener.sent &&
            listener.heard >= Math.min(metadata.duration / 2, 240) * 1000
          ) {
            listener.sent = true;
            this.service.repository.enqueue(
              previous.state.playbackId + ':' + user,
              user,
              {
                ...metadata,
                timestamp: listener.timestamp,
                chosenByUser: previous.state.current?.requestedBy === user ? '1' : '0',
              },
              now,
            );
            void this.service.flush();
          }
        }
      }
    }
    if (!state.playbackId || state.playbackId !== previous?.state.playbackId)
      this.listeners.clear();
    for (const user of this.listeners.keys())
      if (!linked.has(user)) this.listeners.delete(user);
    const metadata = lastFmMetadata(state.current);
    if (metadata && metadata.duration > 30 && state.playbackActive && !state.paused) {
      for (const user of audience) {
        if (!linked.has(user) || this.listeners.has(user)) continue;
        const listener = { heard: 0, timestamp: Math.floor(now / 1000), sent: false };
        this.listeners.set(user, listener);
        void this.service.nowPlaying(user, {
          ...metadata,
          timestamp: listener.timestamp,
          chosenByUser: '0',
        });
      }
    }
    this.previous = {
      state: structuredClone(state),
      audience: new Set(audience),
      at: now,
    };
  }
}
