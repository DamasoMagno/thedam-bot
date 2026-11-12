import type { Track } from './types.ts';

export class SearchCache {
  private entries = new Map<string, { tracks: Track[]; expiresAt: number }>();
  private ttlMs: number;
  private maxEntries: number;
  private now: () => number;
  constructor(ttlMs = 300000, maxEntries = 100, now = Date.now) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.tracks.map((track) => ({ ...track }));
  }
  set(key: string, tracks: Track[]) {
    for (const [id, entry] of this.entries)
      if (entry.expiresAt <= this.now()) this.entries.delete(id);
    if (!tracks.length) return;
    this.entries.delete(key);
    this.entries.set(key, {
      tracks: tracks.map((track) => ({ ...track })),
      expiresAt: this.now() + this.ttlMs,
    });
    while (this.entries.size > this.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
  }
  get size() {
    return this.entries.size;
  }
}
