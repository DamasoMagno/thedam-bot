import type { AudioLocation } from './audio-location-cache.ts';
import { PassThrough } from 'node:stream';
import type { Track, AudioSource, MusicCatalog } from './types.ts';

export function createResolvedSource(
  track: Track,
  catalog: MusicCatalog,
  factory: (
    track: Track,
    fail: (error?: Error) => void,
    location?: AudioLocation,
  ) => AudioSource,
  onFailure: (error?: Error) => void,
): AudioSource {
  if (track.provider === 'youtube' && !catalog.audioLocation)
    return factory(track, onFailure);
  const stream = new PassThrough({ highWaterMark: 65536 });
  const controller = new AbortController();
  let source: AudioSource | undefined;
  let stopped = false,
    paused = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    source?.stop();
    stream.destroy();
  };
  const fail = (error?: Error) => {
    if (stopped) return;
    stop();
    onFailure(error);
  };
  void (
    track.provider === 'youtube'
      ? Promise.resolve(track)
      : catalog.playable(track, { signal: controller.signal })
  )
    .then(async (resolved) => {
      const location = await catalog.audioLocation?.(resolved, {
        signal: controller.signal,
      });
      if (stopped) return;
      source = factory(resolved, fail, location);
      if (stopped) {
        source.stop();
        return;
      }
      source.stream.on('error', fail);
      source.stream.pipe(stream);
      if (paused) source.pause?.();
    })
    .catch((error) =>
      fail(
        error instanceof Error
          ? error
          : new Error('Não foi possível preparar esta música.'),
      ),
    );
  return {
    stream,
    stop,
    pause() {
      paused = true;
      source?.pause?.();
    },
    resume() {
      paused = false;
      source?.resume?.();
    },
  };
}
