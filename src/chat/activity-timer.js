export function createActivityTimer({
  enabled,
  speak,
  now = Date.now,
  schedule = setInterval,
  cancel = clearInterval,
  intervalMs = 5 * 60000,
  activityMs = 10 * 60000,
  quietMs = 60000,
}) {
  let lastActivity = -Infinity;
  let lastReply = -Infinity;
  let lastAttempt = now();
  let channel,
    busy = false,
    closed = false;
  async function tick() {
    const time = now();
    if (
      closed ||
      busy ||
      !channel ||
      !enabled() ||
      time - lastActivity > activityMs ||
      time - lastAttempt < intervalMs ||
      time - lastReply < quietMs
    )
      return;
    busy = true;
    lastAttempt = time;
    try {
      await speak(channel);
    } catch {
      console.warn('Não foi possível enviar a mensagem espontânea do Markov.');
    } finally {
      busy = false;
    }
  }
  const timer = schedule(() => {
    void tick();
  }, 60000);
  timer.unref?.();
  return {
    noteActivity(value) {
      if (!closed) {
        lastActivity = now();
        channel = value;
      }
    },
    noteReply() {
      lastReply = now();
    },
    tick,
    close() {
      closed = true;
      channel = undefined;
      cancel(timer);
    },
  };
}
