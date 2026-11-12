import type {
  APIActionRowComponent,
  APIStringSelectComponent,
  APIButtonComponentWithCustomId,
  ButtonStyle,
  MessageCreateOptions,
  Message,
  SendableChannels,
} from 'discord.js';
import type { MusicState, ServiceResult, PlaylistSummary } from './types.ts';
import type { PlayerService } from './player-service.ts';
type ActionRow = APIActionRowComponent<
  APIButtonComponentWithCustomId | APIStringSelectComponent
>;
import { escapeMarkdown } from 'discord.js';
import { MusicError } from '../shared/music-error.ts';
export const safeTitle = (value: unknown, length = 80) =>
  escapeMarkdown(
    String(value || 'Música')
      .replace(/@/g, '')
      .slice(0, length),
  );
export const messagePayload = (content: string, components: ActionRow[] = []) => ({
  content,
  components,
  allowedMentions: { parse: [] as never[], repliedUser: false },
});
export const button = (
  label: string,
  id: string,
  style: Exclude<ButtonStyle, 5 | 6> = 2,
  disabled = false,
): APIButtonComponentWithCustomId => ({
  type: 2,
  label,
  custom_id: 'dam:' + id,
  style,
  disabled,
});
export const row = (
  ...components: (APIButtonComponentWithCustomId | APIStringSelectComponent)[]
): ActionRow => ({ type: 1, components });
export function selection(
  id: string,
  placeholder: string,
  items: { label: string; value: string; description?: string }[],
  page = 0,
): ActionRow[] {
  const offset = page * 20;
  const options = items.slice(offset, offset + 20).map((item) => ({
    label: String(item.label).slice(0, 100),
    value: item.value,
    description: item.description ? String(item.description).slice(0, 100) : undefined,
  }));
  if (!options.length) return [];
  const components = [
    row({
      type: 3,
      custom_id: 'dam:' + id,
      placeholder,
      min_values: 1,
      max_values: 1,
      options,
    }),
  ];
  if (items.length > 20)
    components.push(
      row(
        button('Anterior', `page:${id}:${page - 1}`, 2, page === 0),
        button('Próxima', `page:${id}:${page + 1}`, 2, offset + 20 >= items.length),
      ),
    );
  return components;
}
export function queuePayload(
  state: ServiceResult,
  {
    page = 0,
    selectedId,
    removeOnly = false,
  }: { page?: number; selectedId?: string; removeOnly?: boolean } = {},
) {
  const queue = state.queue || [];
  const index = selectedId
    ? queue.findIndex((track) => track.queueId === selectedId)
    : -1;
  if (selectedId && index < 0)
    throw new MusicError(
      409,
      'Esta música não está mais na fila. Abra Fila novamente.',
    );
  page =
    index >= 0
      ? Math.floor(index / 20)
      : Math.min(Math.max(0, page), Math.max(0, Math.ceil(queue.length / 20) - 1));
  let text = state.current
    ? `**${state.paused ? 'Pausada' : 'Tocando'}:** ${safeTitle(state.current.title)}`
    : 'Nenhuma música está tocando.';
  text +=
    '\n' +
    (queue
      .slice(page * 20, page * 20 + 20)
      .map(
        (track, offset) => `${page * 20 + offset + 1}. ${safeTitle(track.title, 35)}`,
      )
      .join('\n') || 'Nenhuma música na fila.');
  const components = selection(
    removeOnly ? 'remove' : 'queueTrack',
    removeOnly ? 'Remover música da fila' : 'Escolher música da fila',
    queue.map((track, position) => ({
      label: `${position + 1}. ${track.title}`,
      description: track.artist,
      value: track.queueId!,
    })),
    page,
  );
  if (index >= 0) {
    const track = queue[index];
    text += `\n\n**Selecionada:** ${safeTitle(track.title, 50)}`;
    components.push(
      row(
        button('Subir', 'moveUp:' + track.queueId, 2, index === 0),
        button('Descer', 'moveDown:' + track.queueId, 2, index === queue.length - 1),
        button('Remover', 'queueRemove:' + track.queueId, 4),
      ),
    );
  }
  if (state.current)
    components.push(
      row(
        button('Embaralhar', 'shuffle'),
        button(state.repeat ? 'Desligar repetição' : 'Repetir música', 'repeatToggle'),
        button('Salvar fila', 'saveQueue'),
        button('Limpar duplicadas', 'deduplicate'),
        button('Encerrar', 'stop', 4),
      ),
    );
  return messagePayload(text, components);
}

export function panelPayload(
  state: MusicState,
  playlists: PlaylistSummary[] = [],
  voiceAvailable = false,
  lastfmAvailable = false,
) {
  const current = state.current
    ? `**${state.paused ? 'Pausada' : 'Tocando agora'}:** ${safeTitle(state.current.title)}${state.current.artist ? ' — ' + safeTitle(state.current.artist, 50) : ''}`
    : state.waitingToLeave
      ? 'Fila vazia. Vou sair da call após 1 minuto sem música.'
      : 'Nenhuma música tocando.';
  const queue = state.queue
    .slice(0, 5)
    .map((track, index) => `${index + 1}. ${safeTitle(track.title, 40)}`)
    .join('\n');
  const content = `${state.voiceRequests ? 'Comando por voz em andamento.\n' : ''}**TheDam · Música**\n${current}\n${queue ? '\n**A seguir**\n' + queue : '\nFila vazia.'}${state.queue.length > 5 ? '\nE mais ' + (state.queue.length - 5) + ' música(s).' : ''}${state.error ? '\n' + state.error : ''}`;
  const inactive = !state.current;
  return messagePayload(content, [
    row(
      button('Adicionar música', 'addMusic', 1),
      button(
        state.paused ? 'Continuar' : 'Pausar',
        state.paused ? 'resume' : 'pause',
        2,
        inactive,
      ),
      button('Pular', 'skip', 2, inactive),
      button('Fila', 'state'),
      button('Playlists', 'playlists'),
    ),
    ...selection(
      'playPlaylist',
      'Tocar uma playlist na call',
      playlists.map((list) => ({
        label: list.name,
        value: list.id,
        description: `${list.count} música(s)`,
      })),
    ),
    ...(voiceAvailable ? [row(button('Comando por voz', 'voiceCommand'))] : []),
    ...selection('more', 'Mais opções', [
      { label: 'Favoritar música atual', value: 'favorite' },
      { label: 'Salvar música atual numa playlist', value: 'saveCurrent' },
      { label: 'Minhas favoritas', value: 'favorites' },
      { label: 'Músicas recentes', value: 'history' },
      ...(lastfmAvailable
        ? [{ label: 'Last.fm · perfil e sugestões', value: 'lastfm' }]
        : []),
      { label: 'Encerrar reprodução', value: 'stop' },
    ]),
  ]);
}

export class MusicPanels {
  voiceAvailable: boolean;
  lastfmAvailable: boolean;
  service!: PlayerService;
  schedule!: typeof setTimeout;
  cancel!: typeof clearTimeout;
  shows = new Map<string, Promise<void>>();
  panels: Map<string, Message>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  refreshes: Map<string, Promise<void>>;
  closed: boolean;
  unsubscribe?: () => void;
  constructor({
    service,
    schedule = setTimeout,
    cancel = clearTimeout,
    voiceAvailable = false,
    lastfmAvailable = false,
  }: {
    service: PlayerService;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
    voiceAvailable?: boolean;
    lastfmAvailable?: boolean;
  }) {
    Object.assign(this, { service, schedule, cancel });
    this.voiceAvailable = voiceAvailable;
    this.lastfmAvailable = lastfmAvailable;
    this.panels = new Map();
    this.timers = new Map();
    this.refreshes = new Map();
    this.closed = false;
    this.unsubscribe = service.onChange?.((guild) => this.scheduleRefresh(guild));
  }
  scheduleRefresh(guild: string) {
    if (this.closed || !this.panels.has(guild) || this.timers.has(guild)) return;
    const timer = this.schedule(() => {
      this.timers.delete(guild);
      void this.refresh(guild);
    }, 400);
    timer.unref?.();
    this.timers.set(guild, timer);
  }
  async show(guild: string, channel: SendableChannels) {
    const previous = this.shows.get(guild) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.showPanel(guild, channel));
    this.shows.set(guild, next);
    try {
      await next;
    } finally {
      if (this.shows.get(guild) === next) this.shows.delete(guild);
    }
  }
  async showPanel(guild: string, channel: SendableChannels) {
    if (this.closed) return;
    const existing = this.panels.get(guild);
    if (existing && existing.channelId === channel.id) {
      await this.refresh(guild);
      if (this.panels.has(guild)) return;
    }
    // Keep exactly one active panel; messages in previous channels become read-only.
    if (existing)
      await existing
        .edit(messagePayload('Painel de música movido para outro canal.'))
        .catch(() => {});
    let message: Message;
    try {
      message = await channel.send(
        panelPayload(
          this.service.state(guild),
          this.service.playlistsForPanel?.(guild) || [],
          this.voiceAvailable,
          this.lastfmAvailable,
        ),
      );
    } catch {
      throw new MusicError(
        403,
        'Não consegui publicar o painel. Confira Ver canal e Enviar mensagens. A fila foi preservada.',
      );
    }
    if (this.closed) return;
    this.panels.set(guild, message);
  }
  async refresh(guild: string) {
    const previous = this.refreshes.get(guild) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const panel = this.panels.get(guild);
        if (!panel || this.closed) return;
        try {
          await panel.edit(
            panelPayload(
              this.service.state(guild),
              this.service.playlistsForPanel?.(guild) || [],
              this.voiceAvailable,
              this.lastfmAvailable,
            ),
          );
        } catch {
          this.panels.delete(guild);
        }
      });
    this.refreshes.set(guild, next);
    try {
      await next;
    } finally {
      if (this.refreshes.get(guild) === next) this.refreshes.delete(guild);
    }
  }
  close() {
    this.closed = true;
    this.unsubscribe?.();
    for (const timer of this.timers.values()) this.cancel(timer);
    this.timers.clear();
    this.panels.clear();
  }
}
