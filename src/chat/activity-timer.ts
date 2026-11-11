import type { ChatChannel } from './types.ts';
export interface ActivityOptions {
  enabled: () => boolean;
  speak: (channel: ChatChannel) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  windowMs?: number;
  minMessages?: number;
  minAuthors?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  quietMs?: number;
  cooldownMs?: number;
  profile?: () => string;
}
export function createActivityTimer({
  enabled,
  speak,
  now = Date.now,
  random = Math.random,
  schedule = setTimeout,
  cancel = clearTimeout,
  windowMs = 180000,
  minMessages = 6,
  minAuthors = 2,
  minDelayMs = 120000,
  maxDelayMs = 300000,
  quietMs = 60000,
  cooldownMs = 120000,
  profile = () => 'discreet',
}: ActivityOptions) {
  const activity: { at: number; author: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined,
    due = 0,
    channel: ChatChannel | undefined,
    busy = false,
    closed = false,
    lastReply = -Infinity;
  const prune = () => {
    while (activity.length && activity[0].at < now() - windowMs) activity.shift();
  };
  const active = () => {
    prune();
    return (
      activity.length >=
        (profile() === 'participative' ? Math.max(4, minMessages - 2) : minMessages) &&
      new Set(activity.map((item) => item.author)).size >= minAuthors &&
      now() - activity.at(-1)!.at <= quietMs
    );
  };
  const clear = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    due = 0;
  };
  async function tick() {
    if (timer === undefined || now() < due) return;
    clear();
    if (closed || busy || !enabled() || !active() || now() - lastReply < cooldownMs)
      return;
    busy = true;
    try {
      if (channel) await speak(channel);
    } catch {
      console.warn('Não foi possível enviar a mensagem espontânea do Markov.');
    } finally {
      busy = false;
    }
  }
  return {
    noteActivity(value: ChatChannel, author: string) {
      if (closed || !author) return;
      activity.push({ at: now(), author });
      if (activity.length > 200) activity.shift();
      channel = value;
      prune();
      if (!enabled()) {
        clear();
        return;
      }
      if (timer !== undefined || busy || !active() || now() - lastReply < cooldownMs)
        return;
      const delay =
        minDelayMs +
        Math.floor(
          Math.max(0, Math.min(1, random())) *
            ((profile() === 'participative'
              ? Math.min(maxDelayMs, 180000)
              : maxDelayMs) -
              minDelayMs),
        );
      due = now() + delay;
      timer = schedule(() => {
        void tick();
      }, delay);
      timer?.unref?.();
    },
    noteReply() {
      lastReply = now();
      clear();
    },
    tick,
    reset() {
      activity.length = 0;
      clear();
    },
    close() {
      closed = true;
      channel = undefined;
      activity.length = 0;
      clear();
    },
  };
}
