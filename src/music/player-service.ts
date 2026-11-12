import { prepareAudioSource, type PreparedSource } from './prepared-source.ts';
import { createRecoverableSource } from './recoverable-source.ts';
import type {
  Track,
  QueuedTrack,
  MusicRoom,
  MusicState,
  TrackView,
  MusicInput,
  ServiceResult,
  MusicGateway,
  MusicCatalog,
  AudioSource,
  Diagnostics,
} from './types.ts';
import type { LibraryRepository } from './library-repository.ts';
interface PlayerDependencies {
  catalog: MusicCatalog;
  gateway: MusicGateway;
  source: (track: Track, fail: (error?: Error) => void) => AudioSource;
  maxQueue?: number;
  library?: LibraryRepository;
  diagnostics?: () => Diagnostics;
  random?: () => number;
  allowedGuildId?: string;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
}
import { randomUUID } from 'node:crypto';
import { MusicError } from '../shared/music-error.ts';
export class PlayerService {
  private idleDisconnects = new Map<
    string,
    { room: MusicRoom; timer: ReturnType<typeof setTimeout> }
  >();
  private schedule: typeof setTimeout;
  private cancel: typeof clearTimeout;
  catalog!: MusicCatalog;
  gateway!: MusicGateway;
  source!: PlayerDependencies['source'];
  maxQueue!: number;
  library?: LibraryRepository;
  diagnostics!: () => Diagnostics;
  random!: () => number;
  allowedGuildId!: string;
  versions: Map<string, number>;
  pending: Map<string, Set<AbortController>>;
  listeners: Set<(guild: string, state: MusicState) => void>;
  rooms: Map<string, MusicRoom>;
  results: Map<
    string,
    {
      track: Track;
      guild: string;
      user: string;
      expires: number;
      purpose?: 'playback' | 'library';
    }
  >;
  locks: Map<string, Promise<ServiceResult>>;
  constructor({
    catalog,
    gateway,
    source,
    maxQueue = 50,
    library,
    diagnostics = () => ({}),
    random = Math.random,
    allowedGuildId = '1379585303295299714',
    schedule = setTimeout,
    cancel = clearTimeout,
  }: PlayerDependencies) {
    Object.assign(this, {
      catalog,
      gateway,
      source,
      maxQueue,
      allowedGuildId,
      library,
      diagnostics,
      random,
    });
    this.schedule = schedule;
    this.cancel = cancel;
    this.versions = new Map();
    this.pending = new Map();
    this.listeners = new Set();
    this.rooms = new Map();
    this.results = new Map();
    this.locks = new Map();
  }
  async run(
    guild: string,
    user: string,
    action: string,
    input: MusicInput = {},
  ): Promise<ServiceResult> {
    if (guild !== this.allowedGuildId)
      throw new MusicError(403, 'Música disponível somente no servidor Amigos.');
    if (
      [
        'playlist',
        'playlistRemoveTrack',
        'playlistSearch',
        'playlistAddTrack',
        'importPlaylist',
        'createPlaylist',
        'deletePlaylist',
      ].includes(action)
    ) {
      await (this.gateway.member
        ? this.gateway.member(guild, user)
        : this.gateway.authorize(guild, user));
      this.requireLibrary();
      const admin = (await this.gateway.isAdmin?.(guild, user)) || false;
      if (action === 'playlist') {
        const playlist = this.library.playlist(guild, input.id || '');
        return { playlist, canEdit: playlist.owner === user || admin };
      }
      if (input.id) this.library.assertCanEdit(guild, user, input.id, admin);
      if (action === 'playlistRemoveTrack') {
        const playlist = this.library.removeTrack(
          guild,
          user,
          input.id || '',
          input.position!,
          input.revision || '',
          admin,
        );
        this.notify(guild);
        return { playlist };
      }
      if (action === 'createPlaylist') {
        const playlist = this.library.createPlaylist(
          guild,
          user,
          input.name,
          input.category,
        );
        this.notify(guild);
        return { playlist };
      }
      if (action === 'deletePlaylist') {
        this.library.deletePlaylist(guild, user, input.id || '', admin);
        this.notify(guild);
        return { deleted: true };
      }
      if (action === 'playlistSearch') {
        if (!input.id) throw new MusicError(400, 'Escolha uma playlist.');
        const tracks = await this.catalog.search(
          input.query,
          input.provider || 'youtube',
        );
        this.library.assertCanEdit(guild, user, input.id, admin);
        return { tracks: this.trackResults(guild, user, tracks, 'library') };
      }
      if (action === 'playlistAddTrack') {
        const found = this.results.get(input.token || '');
        if (
          !found ||
          found.guild !== guild ||
          found.user !== user ||
          found.purpose !== 'library' ||
          found.expires <= Date.now()
        )
          throw new MusicError(410, 'Faça a busca novamente; este resultado expirou.');
        const playlist = this.library.addToPlaylist(
          guild,
          user,
          input.id || '',
          found.track,
          admin,
        );
        this.results.delete(input.token || '');
        this.notify(guild);
        return { playlist };
      }
      if (!this.catalog.importPlaylist)
        throw new MusicError(503, 'Importação do Spotify indisponível.');
      const imported = await this.catalog.importPlaylist(input.query);
      await (this.gateway.member
        ? this.gateway.member(guild, user)
        : this.gateway.authorize(guild, user));
      const currentAdmin = (await this.gateway.isAdmin?.(guild, user)) || false;
      const playlist = input.id
        ? this.library.addTracks(guild, user, input.id, imported.tracks, currentAdmin)
        : this.library.createPlaylist(
            guild,
            user,
            input.name || imported.name,
            input.category || 'Spotify',
            imported.tracks,
          );
      this.notify(guild);
      return { playlist, skipped: imported.skipped };
    }
    if (['status', 'playlists', 'favorites', 'history'].includes(action)) {
      await (this.gateway.member
        ? this.gateway.member(guild, user)
        : this.gateway.authorize(guild, user));
      if (action === 'status') return this.diagnostics();
      this.requireLibrary();
      if (action === 'playlists') return { playlists: this.library.playlists(guild) };
      if (action === 'favorites')
        return { favorites: this.library.favorites(guild, user) };
      return { history: this.library.history(guild) };
    }
    const version = this.versions.get(guild) || 0;
    const channel = await this.gateway.authorize(guild, user);
    this.checkChannel(guild, channel);
    if (action === 'stop') {
      this.versions.set(guild, (this.versions.get(guild) || 0) + 1);
      for (const controller of this.pending.get(guild) || []) controller.abort();
      for (const [token, result] of this.results)
        if (result.guild === guild && result.purpose !== 'library')
          this.results.delete(token);
      this.stop(guild);
      this.notify(guild);
      return this.state(guild);
    }
    if (
      action === 'search' ||
      action === 'enqueue' ||
      action === 'playlistEnqueue' ||
      action === 'favoriteEnqueue' ||
      action === 'historyEnqueue'
    ) {
      const controller = new AbortController();
      const requests = this.pending.get(guild) || new Set();
      requests.add(controller);
      this.pending.set(guild, requests);
      try {
        if (action === 'search') {
          const tracks = await this.catalog.search(
            input.query,
            input.provider || 'youtube',
            { signal: controller.signal },
          );
          this.checkVersion(guild, version);
          if ((await this.gateway.authorize(guild, user)) !== channel)
            throw new MusicError(409, 'Sua call mudou. Tente novamente.');
          this.checkChannel(guild, channel);
          this.cleanupResults();
          const result = {
            tracks: tracks.map((track) => {
              const token = randomUUID();
              this.results.set(token, {
                track,
                guild,
                user,
                expires: Date.now() + 600000,
              });
              return { token, ...track };
            }),
          };
          this.cleanupResults();
          return result;
        }
        let tracks;
        if (action === 'enqueue') {
          const found = this.results.get(input.token || '');
          if (
            !found ||
            found.guild !== guild ||
            found.user !== user ||
            found.purpose === 'library' ||
            found.expires <= Date.now()
          )
            throw new MusicError(
              410,
              'Faça a busca novamente; este resultado expirou.',
            );
          tracks = [found.track];
        } else {
          this.requireLibrary();
          if (action === 'playlistEnqueue')
            tracks = this.library.playlist(guild, input.id || '').tracks;
          else {
            const entries =
              action === 'favoriteEnqueue'
                ? this.library.favorites(guild, user)
                : this.library.history(guild);
            const entry = entries.find((item) => item.id === input.id);
            if (!entry) throw new MusicError(404, 'Música não encontrada.');
            tracks = [entry.track];
          }
          if (!tracks.length) throw new MusicError(409, 'Esta playlist está vazia.');
        }
        if (tracks.length > this.maxQueue - (this.rooms.get(guild)?.queue.length || 0))
          throw new MusicError(
            409,
            'Não há espaço para todas as músicas na fila. Remova algumas antes.',
          );
        const prepared: Track[] = [];
        const prepareFirst = !this.rooms.get(guild)?.current;
        for (const [index, track] of tracks.entries()) {
          this.checkVersion(guild, version);
          prepared.push(
            index === 0 && prepareFirst
              ? await this.catalog.playable(track, { signal: controller.signal })
              : track,
          );
        }
        this.checkVersion(guild, version);
        return await this.serial(guild, async () => {
          this.checkVersion(guild, version);
          const state = await this.execute(
            guild,
            user,
            'enqueue',
            {
              ...input,
              prepared,
              expectedChannel: channel,
              version,
            },
            { signal: controller.signal },
          );
          this.notify(guild);
          return state;
        });
      } catch (error) {
        if (controller.signal.aborted)
          throw new MusicError(409, 'Pedido cancelado: a reprodução foi encerrada.');
        throw error;
      } finally {
        requests.delete(controller);
        if (!requests.size) this.pending.delete(guild);
      }
    }
    return this.serial(guild, async () => {
      this.checkVersion(guild, version);
      const result = await this.execute(guild, user, action, input);
      this.notify(guild);
      return result;
    });
  }
  async serial(
    guild: string,
    operation: () => Promise<ServiceResult>,
  ): Promise<ServiceResult> {
    const previous = this.locks.get(guild) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.locks.set(guild, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(guild) === next) this.locks.delete(guild);
    }
  }
  checkVersion(guild: string, version: number) {
    if ((this.versions.get(guild) || 0) !== version)
      throw new MusicError(409, 'Pedido cancelado: a reprodução foi encerrada.');
  }
  checkChannel(guild: string, channel: string) {
    const room = this.rooms.get(guild);
    if (room && room.channel !== channel)
      throw new MusicError(409, 'O bot já está tocando em outra call deste servidor.');
  }
  requireLibrary(): asserts this is this & { library: LibraryRepository } {
    if (!this.library) throw new MusicError(503, 'Biblioteca de músicas indisponível.');
  }
  playlistsForPanel(guild: string) {
    return guild === this.allowedGuildId ? this.library?.playlists(guild) || [] : [];
  }
  onChange(listener: (guild: string, state: MusicState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(guild: string) {
    for (const listener of this.listeners)
      try {
        listener(guild, this.state(guild));
      } catch {}
  }
  private cancelIdleDisconnect(guild: string) {
    const idle = this.idleDisconnects.get(guild);
    if (!idle) return;
    this.idleDisconnects.delete(guild);
    this.cancel(idle.timer);
  }
  private scheduleIdleDisconnect(guild: string, room: MusicRoom) {
    if (
      this.rooms.get(guild) !== room ||
      room.current ||
      room.queue.length ||
      room.voiceUsers?.size ||
      this.idleDisconnects.has(guild)
    )
      return;
    const idle = {
      room,
      timer: this.schedule(() => {
        if (this.idleDisconnects.get(guild) !== idle || this.rooms.get(guild) !== room)
          return;
        this.idleDisconnects.delete(guild);
        if (!room.current && !room.queue.length && !room.voiceUsers?.size)
          this.stop(guild);
      }, 60000),
    };
    idle.timer.unref?.();
    this.idleDisconnects.set(guild, idle);
  }
  private async connectRoom(
    guild: string,
    user: string,
    channel: string,
    version: number,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const existing = this.rooms.get(guild);
    if (existing) return existing;
    const connection = await this.gateway.connect(guild, channel, signal);
    try {
      signal?.throwIfAborted();
      this.checkVersion(guild, version);
      if ((await this.gateway.authorize(guild, user)) !== channel)
        throw new MusicError(409, 'Sua call mudou enquanto o bot conectava.');
    } catch (error) {
      connection.destroy();
      throw error;
    }
    const room: MusicRoom = {
      channel,
      queue: [],
      current: null,
      paused: false,
      error: null,
      source: null,
      advancing: false,
      connection,
    };
    this.rooms.set(guild, room);
    const activeRoom = room;
    connection.onPlaybackState?.((playing) => {
      if (this.rooms.get(guild) !== activeRoom) return;
      activeRoom.playbackActive = playing;
      this.notify(guild);
    });
    connection.onIdle(() => {
      if (activeRoom.current) void this.advance(guild, activeRoom);
    });
    connection.onError(() => {
      activeRoom.repeat = false;
      activeRoom.error = 'Falha na reprodução. Tentando a próxima música.';
      void this.advance(guild, activeRoom);
    });
    connection.onDisconnect(() => {
      if (this.rooms.get(guild) === activeRoom) this.stop(guild);
    });
    return room;
  }
  async listen(guild: string, user: string, onAudio: (pcm: Buffer) => void) {
    await this.run(guild, user, 'voiceJoin');
    const room = this.rooms.get(guild);
    if (!room)
      throw new MusicError(409, 'A conexão da call foi encerrada. Tente novamente.');
    if (!room.connection.listen) {
      this.scheduleIdleDisconnect(guild, room);
      throw new MusicError(503, 'Este adaptador não suporta receber voz.');
    }
    room.voiceUsers ||= new Set();
    room.voiceUsers.add(user);
    this.cancelIdleDisconnect(guild);
    let detach: () => void;
    try {
      detach = room.connection.listen(user, onAudio);
    } catch {
      room.voiceUsers.delete(user);
      this.scheduleIdleDisconnect(guild, room);
      throw new MusicError(503, 'Não foi possível abrir a escuta. Use /tocar.');
    }
    this.notify(guild);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      detach();
      room.voiceUsers?.delete(user);
      if (this.rooms.get(guild) !== room) return;
      this.scheduleIdleDisconnect(guild, room);
      this.notify(guild);
    };
  }
  async execute(
    guild: string,
    user: string,
    action: string,
    input: MusicInput,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<ServiceResult> {
    const channel = await this.gateway.authorize(guild, user);
    let room = this.rooms.get(guild);
    if (room && room.channel !== channel)
      throw new MusicError(409, 'O bot já está tocando em outra call deste servidor.');
    if (action === 'state') return this.state(guild);
    if (action === 'voiceJoin') {
      await this.connectRoom(guild, user, channel, this.versions.get(guild) || 0);
      return this.state(guild);
    }
    if (action === 'enqueue') {
      if (input.version !== undefined) this.checkVersion(guild, input.version);
      if (input.expectedChannel && channel !== input.expectedChannel)
        throw new MusicError(409, 'Sua call mudou. Tente novamente.');
      if (input.token && !this.results.has(input.token))
        throw new MusicError(
          410,
          'Este resultado já foi usado. Faça a busca novamente.',
        );
      const prepared = input.prepared;
      if (!prepared?.length) throw new MusicError(400, 'Música inválida.');
      if ((room?.queue.length || 0) + prepared.length > this.maxQueue)
        throw new MusicError(409, 'A fila está cheia.');
      const existingRoom = room;
      const preparation = new AbortController();
      const preparationSignal = signal
        ? AbortSignal.any([signal, preparation.signal])
        : preparation.signal;
      const warmed = !room?.current
        ? prepareAudioSource(prepared[0], this.source, preparationSignal)
        : undefined;
      let connecting: Promise<MusicRoom> | undefined;
      if (room && warmed) this.cancelIdleDisconnect(guild);
      try {
        if (warmed) {
          connecting = room
            ? Promise.resolve(room)
            : this.connectRoom(
                guild,
                user,
                channel,
                input.version ?? (this.versions.get(guild) || 0),
                preparationSignal,
              );
          const [, connected] = await Promise.all([warmed.ready, connecting]);
          room = connected;
        }
        preparationSignal.throwIfAborted();
        if (input.version !== undefined) this.checkVersion(guild, input.version);
        if ((await this.gateway.authorize(guild, user)) !== channel)
          throw new MusicError(409, 'Sua call mudou enquanto o áudio era preparado.');
        if (input.version !== undefined) this.checkVersion(guild, input.version);
        if (!room || this.rooms.get(guild) !== room)
          throw new MusicError(409, 'A conexão da call foi encerrada.');
        if (input.token && !this.results.has(input.token))
          throw new MusicError(
            410,
            'Este resultado já foi usado. Faça a busca novamente.',
          );
        this.results.delete(input.token || '');
        room.queue.push(
          ...prepared.map((track) => ({
            ...track,
            queueId: randomUUID(),
            requestedBy: user,
          })),
        );
        if (!room.current) await this.advance(guild, room, warmed);
      } catch (error) {
        preparation.abort();
        warmed?.stop();
        await connecting?.catch(() => {});
        const connected = this.rooms.get(guild);
        if (
          connected &&
          !connected.current &&
          !connected.queue.length &&
          !connected.voiceUsers?.size
        ) {
          if (connected === existingRoom) this.scheduleIdleDisconnect(guild, connected);
          else this.stop(guild);
        }
        throw error;
      } finally {
        warmed?.stop();
      }

      return this.state(guild);
    }
    if (
      [
        'playlists',
        'favorites',
        'history',
        'savePlaylist',
        'createPlaylist',
        'addToPlaylist',
        'deletePlaylist',
      ].includes(action)
    ) {
      this.requireLibrary();
      if (action === 'playlists') return { playlists: this.library.playlists(guild) };
      if (action === 'favorites')
        return { favorites: this.library.favorites(guild, user) };
      if (action === 'history') return { history: this.library.history(guild) };
      if (action === 'createPlaylist') {
        const playlist = this.library.createPlaylist(
          guild,
          user,
          input.name,
          input.category,
        );
        this.notify(guild);
        return { playlist };
      }
      if (action === 'savePlaylist') {
        const tracks = [room?.current, ...(room?.queue || [])].filter(Boolean);
        if (!tracks.length) throw new MusicError(409, 'Nenhuma música para salvar.');
        if (tracks.length > 50)
          throw new MusicError(
            409,
            'A fila tem mais de 50 músicas. Remova algumas antes de salvar.',
          );
        return {
          playlist: this.library.createPlaylist(
            guild,
            user,
            input.name,
            input.category,
            tracks.filter((track): track is QueuedTrack => Boolean(track)).slice(0, 50),
          ),
        };
      }
      const admin = (await this.gateway.isAdmin?.(guild, user)) || false;
      if (action === 'deletePlaylist') {
        this.library.deletePlaylist(guild, user, input.id || '', admin);
        return { deleted: true };
      }
      if (!room?.current) throw new MusicError(409, 'Nenhuma música está tocando.');
      return {
        playlist: this.library.addToPlaylist(
          guild,
          user,
          input.id || '',
          room.current,
          admin,
        ),
      };
    }
    if (!room) throw new MusicError(409, 'Nenhuma música está tocando.');
    if (
      !room.current &&
      ['pause', 'resume', 'skip', 'favorite', 'repeat'].includes(action)
    )
      throw new MusicError(409, 'Nenhuma música está tocando.');
    if (action === 'favorite') {
      this.requireLibrary();
      return { favorites: this.library.favorite(guild, user, room.current!) };
    }
    if (action === 'move') {
      const index = room.queue.findIndex((track) => track.queueId === input.id);
      if (index < 0)
        throw new MusicError(
          409,
          'Esta música não está mais na fila. Atualize o painel.',
        );
      if (!['up', 'down'].includes(input.direction || ''))
        throw new MusicError(400, 'Escolha Subir ou Descer.');
      const target = index + (input.direction === 'up' ? -1 : 1);
      if (target >= 0 && target < room.queue.length) {
        [room.queue[index], room.queue[target]] = [
          room.queue[target],
          room.queue[index],
        ];
      }
      return this.state(guild);
    }
    if (action === 'remove') {
      const index = room.queue.findIndex((track) => track.queueId === input.id);
      if (index < 0)
        throw new MusicError(
          409,
          'Esta música não está mais na fila. Atualize o painel.',
        );
      room.queue.splice(index, 1);
      return this.state(guild);
    }
    if (action === 'shuffle') {
      for (let index = room.queue.length - 1; index > 0; index--) {
        const other = Math.floor(this.random() * (index + 1));
        [room.queue[index], room.queue[other]] = [room.queue[other], room.queue[index]];
      }
      return this.state(guild);
    }
    if (action === 'deduplicate') {
      const seen = new Set(
        room.current ? [room.current.provider + ':' + room.current.id] : [],
      );
      room.queue = room.queue.filter((track) => {
        const key = track.provider + ':' + track.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return this.state(guild);
    }
    if (action === 'repeat') {
      if (typeof input.enabled !== 'boolean')
        throw new MusicError(400, 'Informe se deseja repetir a música.');
      room.repeat = input.enabled;
      return this.state(guild);
    }

    if (action === 'stop') {
      this.stop(guild);
      return this.state(guild);
    }
    if (action === 'pause') {
      room.connection.pause();
      room.paused = true;
      room.source?.pause?.();
    } else if (action === 'resume') {
      room.connection.resume();
      room.paused = false;
      room.source?.resume?.();
    } else if (action === 'skip') {
      room.repeat = false;
      await this.advance(guild, room);
    } else throw new MusicError(404, 'Ação não encontrada.');
    return this.state(guild);
  }
  async advance(guild: string, room: MusicRoom, warmed?: PreparedSource) {
    if (this.rooms.get(guild) !== room || room.advancing) return;
    this.cancelIdleDisconnect(guild);
    room.advancing = true;
    const previous = room.current;
    room.current = null;
    if (room.repeat && previous) room.queue.unshift(previous);
    room.source?.stop();
    room.source = null;
    room.connection.stop();
    try {
      const track = room.queue.shift();
      if (!track) {
        room.paused = false;
        this.scheduleIdleDisconnect(guild, room);
        return;
      }
      room.current = track;
      room.playbackId = randomUUID();
      room.playbackActive = false;
      room.error = null;
      try {
        this.library?.record(guild, track);
      } catch {
        room.error = 'Não foi possível salvar o histórico.';
      }
      room.paused = false;
      const handleFailure = (error?: Error) => {
        if (this.rooms.get(guild) !== room || room.current !== track) return;
        room.repeat = false;
        room.error =
          error instanceof MusicError
            ? error.message
            : 'Não foi possível tocar esta música. Ela foi removida da fila.';
        void this.advance(guild, room);
      };
      const handleRetry = () => {
        if (this.rooms.get(guild) !== room || room.current !== track) return;
        room.error = 'A fonte falhou. Tentando reiniciar esta música uma vez…';
        this.notify(guild);
      };
      const handleRecovery = () => {
        if (this.rooms.get(guild) !== room || room.current !== track) return;
        room.error = null;
        this.notify(guild);
      };
      room.source = warmed
        ? warmed.take(handleFailure, handleRetry, handleRecovery)
        : createRecoverableSource(
            track,
            this.source,
            handleFailure,
            handleRetry,
            handleRecovery,
          );
      room.connection.play(room.source.stream);
    } finally {
      room.advancing = false;
      this.notify(guild);
    }
  }
  state(guild: string): MusicState {
    const room = this.rooms.get(guild);
    const track = (value: QueuedTrack | null | undefined): TrackView | null =>
      value
        ? {
            queueId: value.queueId,
            requestedBy: value.requestedBy,
            title: value.title,
            artist: value.artist,
            provider: value.provider,
            requestedTitle: value.requestedTitle,
            requestedArtist: value.requestedArtist,
            duration: value.duration,
          }
        : null;
    return {
      playbackActive: room?.playbackActive || false,
      playbackId: room?.current ? room.playbackId : undefined,
      channelId: room?.channel || null,
      current: track(room?.current),
      paused: room?.paused || false,
      queue: (room?.queue || []).map((value) => track(value)!),
      error: room?.error || null,
      repeat: room?.repeat || false,
      voiceRequests: room?.voiceUsers?.size || 0,
      waitingToLeave: this.idleDisconnects.has(guild),
    };
  }
  stop(guild: string) {
    this.cancelIdleDisconnect(guild);
    const room = this.rooms.get(guild);
    if (!room) return;
    this.rooms.delete(guild);
    room.current = null;
    room.source?.stop();
    room.connection.destroy();
    this.notify(guild);
  }
  private trackResults(
    guild: string,
    user: string,
    tracks: Track[],
    purpose: 'library' | 'playback',
  ) {
    this.cleanupResults();
    const results = tracks.map((track) => {
      const token = randomUUID();
      this.results.set(token, {
        track,
        guild,
        user,
        purpose,
        expires: Date.now() + 600000,
      });
      return { token, ...track };
    });
    this.cleanupResults();
    return results;
  }
  cleanupResults() {
    for (const [key, value] of this.results)
      if (value.expires <= Date.now()) this.results.delete(key);
    while (this.results.size > 500)
      this.results.delete(this.results.keys().next().value!);
  }
  close() {
    for (const guild of this.rooms.keys()) this.stop(guild);
    this.results.clear();
    for (const requests of this.pending.values())
      for (const controller of requests) controller.abort();
    this.listeners.clear();
  }
}
