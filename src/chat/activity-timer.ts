import type { ChatChannel } from './types.ts';
export interface ActivityOptions {
  enabled: () => boolean;
  speak: (channel: ChatChannel, isCurrent: () => boolean) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  minDelayMs?: number;
  maxDelayMs?: number;
  profile?: () => string;
}
export function createActivityTimer({
  enabled,
  speak,
  now = Date.now,
  random = Math.random,
  schedule = setTimeout,
  cancel = clearTimeout,
  minDelayMs = 120000,
  maxDelayMs = 300000,
  profile = () => 'discreet',
}: ActivityOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0,
    channel: ChatChannel | undefined,
    busy = false,
    closed = false;
  let revision = 0;
  function clear() {
    revision++;
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    due = 0;
  }
  function arm() {
    if (closed || busy || !channel || timer !== undefined || !enabled()) return;
    const maximum =
      profile() === 'participative' ? Math.min(maxDelayMs, 180000) : maxDelayMs;
    const delay =
      minDelayMs +
      Math.floor(
        Math.max(0, Math.min(1, random())) * Math.max(0, maximum - minDelayMs),
      );
    due = now() + delay;
    timer = schedule(() => {
      void tick();
    }, delay);
    timer.unref?.();
  }
  async function tick() {
    if (timer === undefined || now() < due) return;
    clear();
    if (closed || busy || !enabled() || !channel) return;
    busy = true;
    const currentRevision = revision;
    try {
      await speak(channel, () => !closed && enabled() && revision === currentRevision);
    } catch {
      console.warn('Não foi possível enviar a mensagem espontânea do Markov.');
    } finally {
      busy = false;
      arm();
    }
  }
  return {
    start(value: ChatChannel) {
      channel = value;
      arm();
    },
    noteActivity(value: ChatChannel, _author: string) {
      if (closed) return;
      channel = value;
      if (!enabled()) clear();
      else arm();
    },
    noteReply() {
      clear();
      arm();
    },
    tick,
    reset() {
      clear();
      arm();
    },
    close() {
      closed = true;
      clear();
      channel = undefined;
    },
  };
}
