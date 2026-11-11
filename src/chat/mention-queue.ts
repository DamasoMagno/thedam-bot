import type { ChatMessage } from './types.ts';
export function createMentionQueue({
  respond,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  intervalMs = 1000,
  maxPeople = 22,
}: {
  respond: (message: ChatMessage) => Promise<unknown>;
  now?: () => number;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
  intervalMs?: number;
  maxPeople?: number;
}) {
  const pending = new Map<string, ChatMessage>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    busy = false,
    closed = false,
    lastResponse = -Infinity;
  async function drain() {
    if (closed || busy || !pending.size) return;
    const remaining = intervalMs - (now() - lastResponse);
    if (remaining > 0) {
      if (timer === undefined) {
        timer = schedule(() => {
          timer = undefined;
          void drain();
        }, remaining);
        timer.unref?.();
      }
      return;
    }
    const first = pending.entries().next().value;
    if (!first) return;
    const [author, message] = first;
    pending.delete(author);
    busy = true;
    try {
      await respond(message);
    } catch {
      console.warn('Não foi possível responder à menção do Markov.');
    } finally {
      lastResponse = now();
      busy = false;
      if (!closed) void drain();
    }
  }
  return {
    enqueue(message: ChatMessage) {
      if (closed) return;
      if (!pending.has(message.author.id) && pending.size >= maxPeople) return;
      pending.set(message.author.id, message);
      void drain();
    },
    drain,
    close() {
      closed = true;
      pending.clear();
      if (timer !== undefined) cancel(timer);
    },
  };
}
