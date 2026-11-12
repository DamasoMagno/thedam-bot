import { receiveNextSpeech } from '../voice/receive.ts';
import type { configuration } from '../config/index.ts';
import type { VoiceSession } from '../music/types.ts';
import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  Partials,
} from 'discord.js';
import {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { MusicError } from '../shared/music-error.ts';
export class DiscordGateway {
  config: ReturnType<typeof configuration>;
  client: Client;
  emptyTimers: Map<string, ReturnType<typeof setTimeout>>;
  connections: Map<string, { channel: string; disconnected?: () => void }>;
  constructor(config: ReturnType<typeof configuration>) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        ...(config.markovEnabled
          ? [
              GatewayIntentBits.GuildMessages,
              GatewayIntentBits.MessageContent,
              GatewayIntentBits.GuildMessageReactions,
            ]
          : []),
      ],
      partials: config.markovEnabled ? [Partials.Message, Partials.Reaction] : [],
      allowedMentions: { parse: [], repliedUser: false },
    });
    this.emptyTimers = new Map();
    this.connections = new Map();
    this.client.on('voiceStateUpdate', (before, after) => {
      const guild = after.guild || before.guild;
      const active = this.connections.get(guild.id);
      if (!active) return;
      const botChannel = guild.members.me?.voice.channelId;
      if (botChannel !== active.channel) {
        active.disconnected?.();
        return;
      }
      const candidate = guild.channels.cache.get(active.channel);
      const channel =
        candidate?.type === ChannelType.GuildVoice ? candidate : undefined;
      const listeners = channel?.members.filter((member) => !member.user.bot).size || 0;
      if (listeners) {
        clearTimeout(this.emptyTimers.get(guild.id));
        this.emptyTimers.delete(guild.id);
      } else if (!this.emptyTimers.has(guild.id)) {
        const timer = setTimeout(() => {
          this.emptyTimers.delete(guild.id);
          active.disconnected?.();
        }, config.emptyMs);
        timer.unref();
        this.emptyTimers.set(guild.id, timer);
      }
    });
  }
  async start() {
    await this.client.login(this.config.token);
    if (!this.client.isReady())
      await new Promise((resolve) => this.client.once('clientReady', resolve));
  }
  async member(guildId: string, userId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new MusicError(403, 'Adicione o bot ao servidor Amigos.');
    try {
      return await guild.members.fetch(userId);
    } catch {
      throw new MusicError(403, 'Você não pertence a este servidor.');
    }
  }
  async isAdmin(guild: string, user: string) {
    return (await this.member(guild, user)).permissions.has(
      PermissionsBitField.Flags.ManageGuild,
    );
  }
  async authorize(guildId: string, userId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new MusicError(403, 'Adicione o bot a este servidor do Discord.');
    const member = await this.member(guildId, userId);
    const channel = member.voice.channel;
    if (!channel || channel.type !== ChannelType.GuildVoice)
      throw new MusicError(409, 'Entre em uma call de voz do Discord primeiro.');
    const permissions = channel.permissionsFor(
      guild.members.me || this.client.user!.id,
    );
    if (
      !permissions?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
      ])
    )
      throw new MusicError(
        403,
        'O bot precisa de acesso para ver, conectar e falar nesta call.',
      );
    return channel.id;
  }
  async connect(
    guildId: string,
    channelId: string,
    signal?: AbortSignal,
  ): Promise<VoiceSession> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new MusicError(403, 'Servidor indisponível.');
    const connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    const active: { channel: string; disconnected?: () => void } = {
      channel: channelId,
    };
    connection.on('error', () => active.disconnected?.());
    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : 20000,
      );
    } catch {
      connection.destroy();
      throw new MusicError(502, 'O bot não conseguiu entrar na call.');
    }
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    connection.subscribe(player);
    this.connections.set(guildId, active);
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]).catch(() => active.disconnected?.());
    });
    const voiceListeners = new Set<() => void>();
    let destroying = false;
    return {
      listen: (user, onAudio) => {
        let disposed = false;
        let detach = () => {};
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          detach();
          voiceListeners.delete(dispose);
          if (!voiceListeners.size && !destroying)
            connection.rejoin({ channelId, selfMute: false, selfDeaf: true });
        };
        voiceListeners.add(dispose);
        connection.rejoin({ channelId, selfMute: false, selfDeaf: false });
        detach = receiveNextSpeech(connection.receiver, user, (pcm) => {
          dispose();
          onAudio(pcm);
        });
        return dispose;
      },
      onPlaybackState: (callback) => {
        player.on('stateChange', (_before, after) =>
          callback(after.status === AudioPlayerStatus.Playing),
        );
      },
      onIdle: (callback) => player.on(AudioPlayerStatus.Idle, callback),
      onError: (callback) => player.on('error', callback),
      onDisconnect: (callback) => {
        active.disconnected = callback;
      },
      play: (stream) =>
        player.play(createAudioResource(stream, { inputType: StreamType.Raw })),
      pause: () => player.pause(),
      resume: () => player.unpause(),
      stop: () => player.stop(true),
      destroy: () => {
        destroying = true;
        for (const dispose of voiceListeners) dispose();
        this.connections.delete(guildId);
        clearTimeout(this.emptyTimers.get(guildId));
        this.emptyTimers.delete(guildId);
        player.removeAllListeners();
        player.on('error', () => {});
        player.stop(true);
        connection.removeAllListeners();
        connection.on('error', () => {});
        if (connection.state.status !== VoiceConnectionStatus.Destroyed)
          connection.destroy();
      },
    };
  }
  close() {
    for (const timer of this.emptyTimers.values()) clearTimeout(timer);
    this.client.destroy();
  }
}
