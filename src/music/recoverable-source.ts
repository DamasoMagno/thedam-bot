import { PassThrough } from 'node:stream';
import type { Track, AudioSource } from './types.ts';

// Mantém uma única stream para o player enquanto a fonte é reiniciada uma vez.
export function createRecoverableSource(
  track: Track,
  factory: (track: Track, fail: (error?: Error) => void) => AudioSource,
  onFailure: (error?: Error) => void,
  onRetry: () => void = () => {},
  onRecovered: () => void = () => {},
): AudioSource {
  const output = new PassThrough({ highWaterMark: 65536 });
  let active: AudioSource | undefined;
  let stopped = false,
    paused = false,
    generation = 0,
    attempts = 0;
  let retry: ReturnType<typeof setImmediate> | undefined;
  let detach = () => {};
  function release() {
    detach();
    active?.stream.unpipe(output);
    active?.stop();
    active = undefined;
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    generation++;
    if (retry) clearImmediate(retry);
    release();
    output.destroy();
  }
  function fail(error: Error | undefined, attempt: number) {
    if (stopped || attempt !== generation) return;
    generation++;
    release();
    if (attempts < 2) {
      onRetry();
      retry = setImmediate(() => {
        retry = undefined;
        start();
      });
    } else {
      stop();
      onFailure(error);
    }
  }
  function start() {
    if (stopped) return;
    attempts++;
    const attempt = ++generation;
    const failure = (error?: Error) => queueMicrotask(() => fail(error, attempt));
    try {
      active = factory(track, failure);
      let received = false;
      const end = () => {
        if (stopped || attempt !== generation) return;
        if (!received) failure(new Error('A fonte não entregou áudio.'));
        else output.end();
      };
      const error = (cause: Error) => failure(cause);
      const recovered = () => {
        received = true;
        if (!stopped && attempt === generation && attempts > 1) onRecovered();
      };
      active.stream.once('data', recovered);
      active.stream.once('end', end);
      active.stream.on('error', error);
      const stream = active.stream;
      detach = () => {
        stream.off('data', recovered);
        stream.off('end', end);
        stream.off('error', error);
      };
      active.stream.pipe(output, { end: false });
      if (paused) active.pause?.();
    } catch (error) {
      failure(error instanceof Error ? error : new Error('Falha na fonte de áudio.'));
    }
  }
  start();
  return {
    stream: output,
    stop,
    pause() {
      paused = true;
      active?.pause?.();
    },
    resume() {
      paused = false;
      active?.resume?.();
    },
  };
}
