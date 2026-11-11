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
  queueId?: string;
  title: string;
  artist?: string;
  provider: 'youtube' | 'spotify';
  requestedTitle?: string;
  duration?: number | null;
}
export interface MusicState {
  channelId: string | null;
  current: TrackView | null;
  paused: boolean;
  queue: TrackView[];
  error: string | null;
  repeat: boolean;
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
  markov?: unknown;
}
export interface ServiceResult {
  channelId?: string | null;
  current?: TrackView | null;
  paused?: boolean;
  queue?: TrackView[];
  error?: string | null;
  repeat?: boolean;
  tracks?: SearchTrack[];
  playlists?: PlaylistSummary[];
  playlist?: Playlist;
  favorites?: LibraryEntry[];
  history?: LibraryEntry[];
  deleted?: boolean;
  commands?: boolean;
  spotify?: boolean;
  markovReason?: string;
  audioError?: string | null;
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
  onIdle(callback: () => void): unknown;
  onError(callback: () => void): unknown;
  onDisconnect(callback: () => void): void;
  play(stream: Readable): unknown;
  pause(): unknown;
  resume(): unknown;
  stop(): unknown;
  destroy(): void;
}
export interface MusicRoom {
  channel: string;
  queue: QueuedTrack[];
  current: QueuedTrack | null;
  paused: boolean;
  error: string | null;
  source: AudioSource | null;
  advancing: boolean;
  connection: VoiceSession;
  repeat?: boolean;
}
export interface MusicGateway {
  authorize(guild: string, user: string): Promise<string>;
  connect(guild: string, channel: string): Promise<VoiceSession>;
  member?(guild: string, user: string): Promise<unknown>;
  isAdmin?(guild: string, user: string): Promise<boolean>;
}
export interface MusicCatalog {
  search(
    query: unknown,
    provider?: string,
    options?: { signal?: AbortSignal },
  ): Promise<Track[]>;
  playable(track: Track, options?: { signal?: AbortSignal }): Promise<Track>;
}
