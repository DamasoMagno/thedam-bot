import type { AudioLocation } from './audio-location-cache.ts';
import type { Readable } from 'node:stream';
export interface Track {
  id: string;
  provider: 'youtube' | 'spotify';
  title: string;
  artist?: string;
  duration?: number | null;
  requestedTitle?: string;
  requestedArtist?: string;
}
export interface QueuedTrack extends Track {
  queueId: string;
  requestedBy: string;
}
export interface TrackView {
  requestedBy?: string;
  requestedArtist?: string;
  queueId?: string;
  title: string;
  artist?: string;
  provider: 'youtube' | 'spotify';
  requestedTitle?: string;
  duration?: number | null;
}
export interface MusicState {
  playbackActive?: boolean;
  playbackId?: string;
  channelId: string | null;
  current: TrackView | null;
  paused: boolean;
  queue: TrackView[];
  error: string | null;
  repeat: boolean;
  voiceRequests?: number;
  waitingToLeave?: boolean;
}
export interface SearchTrack extends Track {
  token: string;
}
export interface PlaylistSummary {
  id: string;
  name: string;
  category: string;
  owner: string;
  count: number;
}
export interface Playlist {
  id: string;
  guild: string;
  name: string;
  category: string;
  owner: string;
  created: number;
  tracks: Track[];
  revision: string;
}
export interface LibraryEntry {
  id: string;
  track: Track;
}
export interface Diagnostics {
  commands?: boolean;
  spotify?: boolean;
  markovReason?: string;
  audioError?: string | null;
  audioStartupMs?: number;
  search?: { hits: number; misses: number; lastDurationMs: number; entries: number };
  markov?: unknown;
}
export interface ServiceResult {
  channelId?: string | null;
  current?: TrackView | null;
  paused?: boolean;
  queue?: TrackView[];
  error?: string | null;
  repeat?: boolean;
  voiceRequests?: number;
  waitingToLeave?: boolean;
  tracks?: SearchTrack[];
  playlists?: PlaylistSummary[];
  playlist?: Playlist;
  favorites?: LibraryEntry[];
  history?: LibraryEntry[];
  deleted?: boolean;
  skipped?: number;
  canEdit?: boolean;
  commands?: boolean;
  spotify?: boolean;
  markovReason?: string;
  audioError?: string | null;
  audioStartupMs?: number;
  search?: { hits: number; misses: number; lastDurationMs: number; entries: number };
  markov?: unknown;
}
export interface MusicInput {
  query?: string;
  provider?: string;
  token?: string;
  id?: string;
  name?: string;
  category?: string;
  enabled?: boolean;
  direction?: string;
  position?: number;
  revision?: string;
  prepared?: Track[];
  expectedChannel?: string;
  version?: number;
}
export interface AudioSource {
  stream: Readable;
  stop(): void;
  pause?(): void;
  resume?(): void;
}
export interface VoiceSession {
  onPlaybackState?(callback: (playing: boolean) => void): void;
  onIdle(callback: () => void): unknown;
  onError(callback: () => void): unknown;
  onDisconnect(callback: () => void): void;
  play(stream: Readable): unknown;
  pause(): unknown;
  resume(): unknown;
  stop(): unknown;
  destroy(): void;
  listen?(user: string, onAudio: (pcm: Buffer) => void): () => void;
}
export interface MusicRoom {
  playbackActive?: boolean;
  playbackId?: string;
  channel: string;
  queue: QueuedTrack[];
  current: QueuedTrack | null;
  paused: boolean;
  error: string | null;
  source: AudioSource | null;
  advancing: boolean;
  connection: VoiceSession;
  voiceUsers?: Set<string>;
  repeat?: boolean;
}
export interface MusicGateway {
  authorize(guild: string, user: string): Promise<string>;
  connect(guild: string, channel: string, signal?: AbortSignal): Promise<VoiceSession>;
  member?(guild: string, user: string): Promise<unknown>;
  isAdmin?(guild: string, user: string): Promise<boolean>;
}
export interface MusicCatalog {
  audioLocation?(
    track: Track,
    options?: { signal?: AbortSignal },
  ): Promise<AudioLocation>;
  search(
    query: unknown,
    provider?: string,
    options?: { signal?: AbortSignal },
  ): Promise<Track[]>;
  playable(track: Track, options?: { signal?: AbortSignal }): Promise<Track>;
  importPlaylist?(
    query: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<{ name: string; tracks: Track[]; skipped: number }>;
}
