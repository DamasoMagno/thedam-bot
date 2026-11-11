import type {
  APIActionRowComponent,
  APIStringSelectComponent,
  APIButtonComponentWithCustomId,
  ButtonStyle,
  MessageCreateOptions,
  Message,
  SendableChannels,
} from 'discord.js';
import type { MusicState } from './types.ts';
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
export function panelPayload(state: MusicState) {
  const current = state.current
    ? `**${state.paused ? 'Pausada' : 'Tocando agora'}:** ${safeTitle(state.current.title)}${state.current.artist ? ' — ' + safeTitle(state.current.artist, 50) : ''}`
    : 'Nenhuma música tocando.';
  const queue = state.queue
    .slice(0, 5)
    .map((track, index) => `${index + 1}. ${safeTitle(track.title, 40)}`)
    .join('\n');
  const content = `**TheDam · Música**\n${current}\n${queue ? '\n**A seguir**\n' + queue : '\nFila vazia.'}${state.queue.length > 5 ? '\nE mais ' + (state.queue.length - 5) + ' música(s).' : ''}${state.error ? '\n' + state.error : ''}`;
  const inactive = !state.current;
  return messagePayload(content, [
    row(
      button(
        state.paused ? 'Continuar' : 'Pausar',
        state.paused ? 'resume' : 'pause',
        2,
        inactive,
      ),
      button('Pular', 'skip', 2, inactive),
      button('Fila', 'state'),
      button('Encerrar', 'stop', 4, inactive),
    ),
    row(
      button('Favoritar', 'favorite', 2, inactive),
      button('Playlists', 'playlists'),
      button('Histórico', 'history'),
      button('Favoritas', 'favorites'),
    ),
  ]);
}
export class MusicPanels {
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
  }: {
    service: PlayerService;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
  }) {
    Object.assign(this, { service, schedule, cancel });
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
      message = await channel.send(panelPayload(this.service.state(guild)));
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
          await panel.edit(panelPayload(this.service.state(guild)));
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
