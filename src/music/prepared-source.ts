import type { AudioSource, Track } from './types.ts';
import { createRecoverableSource } from './recoverable-source.ts';
import { MusicError } from '../shared/music-error.ts';

export function prepareAudioSource(
  track: Track,
  factory: (track: Track, fail: (error?: Error) => void) => AudioSource,
  signal?: AbortSignal,
) {
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A conexão pode falhar antes que o chamador comece a aguardar o áudio.
  void ready.catch(() => {});
  let stopped = false,
    transferred = false,
    failure: Error | undefined;
  let onFailure: ((error?: Error) => void) | undefined,
    onRetry: (() => void) | undefined,
    onRecovered: (() => void) | undefined;
  const source = createRecoverableSource(
    track,
    factory,
    (error) => {
      failure = error || new MusicError(502, 'Não foi possível preparar o áudio.');
      rejectReady(failure);
      onFailure?.(failure);
    },
    () => onRetry?.(),
    () => onRecovered?.(),
  );
  const readable = () => {
    if (source.stream.readableLength > 0) {
      source.stream.off('readable', readable);
      resolveReady();
    }
  };
  const closed = () =>
    rejectReady(
      failure || new MusicError(502, 'A fonte encerrou antes de entregar áudio.'),
    );
  source.stream.on('readable', readable);
  source.stream.once('close', closed);
  source.stream.once('end', closed);
  const abort = () => {
    rejectReady(
      signal?.reason instanceof Error
        ? signal.reason
        : new MusicError(409, 'Preparação cancelada.'),
    );
    stop();
  };
  const detach = () => {
    signal?.removeEventListener('abort', abort);
    source.stream.off('readable', readable);
    source.stream.off('close', closed);
    source.stream.off('end', closed);
  };
  function stop() {
    if (stopped || transferred) return;
    stopped = true;
    detach();
    source.stop();
    rejectReady(new MusicError(409, 'Preparação cancelada.'));
  }
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  readable();
  return {
    ready,
    stop,
    take(fail: (error?: Error) => void, retry: () => void, recovered: () => void) {
      if (stopped || transferred || failure)
        throw (
          failure || new MusicError(409, 'Esta preparação não está mais disponível.')
        );
      signal?.throwIfAborted();
      transferred = true;
      onFailure = fail;
      onRetry = retry;
      onRecovered = recovered;
      detach();
      return source;
    },
  };
}
export type PreparedSource = ReturnType<typeof prepareAudioSource>;
