import { randomUUID } from 'node:crypto';
import { MusicError } from './error.js';
export class PlayerService {
  constructor({
    catalog,
    gateway,
    source,
    maxQueue = 50,
    allowedGuildId = '1379585303295299714',
  }) {
    Object.assign(this, { catalog, gateway, source, maxQueue, allowedGuildId });
    this.rooms = new Map();
    this.results = new Map();
    this.locks = new Map();
  }
  async run(guild, user, action, input = {}) {
    if (guild !== this.allowedGuildId)
      throw new MusicError(403, 'Música disponível somente no servidor Amigos.');
    const previous = this.locks.get(guild) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.execute(guild, user, action, input));
    this.locks.set(guild, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(guild) === next) this.locks.delete(guild);
    }
  }
  async execute(guild, user, action, input) {
    const channel = await this.gateway.authorize(guild, user);
    let room = this.rooms.get(guild);
    if (room && room.channel !== channel)
      throw new MusicError(409, 'O bot já está tocando em outra call deste servidor.');
    if (action === 'search') {
      this.cleanupResults();
      const tracks = await this.catalog.search(
        input.query,
        input.provider || 'youtube',
      );
      return {
        tracks: tracks.map((track) => {
          const token = randomUUID();
          this.results.set(token, { track, guild, user, expires: Date.now() + 600000 });
          return { token, ...track };
        }),
      };
    }
    if (action === 'state') return this.state(guild);
    if (action === 'enqueue') {
      const found = this.results.get(input.token);
      if (
        !found ||
        found.guild !== guild ||
        found.user !== user ||
        found.expires <= Date.now()
      )
        throw new MusicError(410, 'Faça a busca novamente; este resultado expirou.');
      if ((room?.queue.length || 0) >= this.maxQueue)
        throw new MusicError(409, 'A fila está cheia.');
      const track = await this.catalog.playable(found.track);
      const activeChannel = await this.gateway.authorize(guild, user);
      if (activeChannel !== channel)
        throw new MusicError(409, 'Sua call mudou. Tente novamente.');
      if (!room) {
        const connection = await this.gateway.connect(guild, channel);
        try {
          if ((await this.gateway.authorize(guild, user)) !== channel)
            throw new MusicError(409, 'Sua call mudou enquanto o bot conectava.');
        } catch (error) {
          connection.destroy();
          throw error;
        }
        room = {
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
        connection.onIdle(() => {
          if (room.current) void this.advance(guild, room);
        });
        connection.onError(() => {
          room.error = 'Falha na reprodução. Tentando a próxima música.';
          void this.advance(guild, room);
        });
        connection.onDisconnect(() => this.stop(guild));
      }
      this.results.delete(input.token);
      room.queue.push({ ...track, requestedBy: user });
      if (!room.current) await this.advance(guild, room);
      return this.state(guild);
    }
    if (!room) throw new MusicError(409, 'Nenhuma música está tocando.');
    if (action === 'stop') {
      this.stop(guild);
      return this.state(guild);
    }
    if (action === 'pause') {
      room.connection.pause();
      room.paused = true;
    } else if (action === 'resume') {
      room.connection.resume();
      room.paused = false;
    } else if (action === 'skip') {
      await this.advance(guild, room);
    } else throw new MusicError(404, 'Ação não encontrada.');
    return this.state(guild);
  }
  async advance(guild, room) {
    if (this.rooms.get(guild) !== room || room.advancing) return;
    room.advancing = true;
    room.current = null;
    room.source?.stop();
    room.source = null;
    room.connection.stop();
    try {
      const track = room.queue.shift();
      if (!track) {
        this.stop(guild);
        return;
      }
      room.current = track;
      room.paused = false;
      room.source = this.source(track, () => {
        if (this.rooms.get(guild) !== room || room.current !== track) return;
        room.error = 'Não foi possível tocar esta música. Ela foi removida da fila.';
        void this.advance(guild, room);
      });
      room.connection.play(room.source.stream);
    } finally {
      room.advancing = false;
    }
  }
  state(guild) {
    const room = this.rooms.get(guild);
    const track = (value) =>
      value
        ? {
            title: value.title,
            artist: value.artist,
            provider: value.provider,
            requestedTitle: value.requestedTitle,
            duration: value.duration,
          }
        : null;
    return {
      channelId: room?.channel || null,
      current: track(room?.current),
      paused: room?.paused || false,
      queue: (room?.queue || []).map(track),
      error: room?.error || null,
    };
  }
  stop(guild) {
    const room = this.rooms.get(guild);
    if (!room) return;
    this.rooms.delete(guild);
    room.current = null;
    room.source?.stop();
    room.connection.destroy();
  }
  cleanupResults() {
    for (const [key, value] of this.results)
      if (value.expires <= Date.now()) this.results.delete(key);
    while (this.results.size > 500)
      this.results.delete(this.results.keys().next().value);
  }
  close() {
    for (const guild of this.rooms.keys()) this.stop(guild);
    this.results.clear();
  }
}
