import { createYoutubeSession } from './youtube-session.ts';
import { youtubeError } from './youtube-error.ts';
import { trustedAudioLocation, type AudioLocation } from './audio-location-cache.ts';
import { Transform } from 'node:stream';
import type { Track } from './types.ts';
import type { configuration } from '../config/index.ts';
import { spawn } from 'node:child_process';
import { youtubeId } from './catalog.ts';
import { MusicError } from '../shared/music-error.ts';
export function createAudioSource(
  config: ReturnType<typeof configuration>,
  track: Track,
  onError: (error: MusicError) => void,
  {
    onReady,
    location,
  }: { onReady?: (elapsedMs: number) => void; location?: AudioLocation } = {},
) {
  const startedAt = performance.now();
  if (!youtubeId(track.id)) throw new MusicError(400, 'Música inválida.');
  if (location) {
    const trusted = trustedAudioLocation(
      location.url,
      location.headers,
      location.format,
    );
    if (!trusted) throw new MusicError(400, 'Fonte de áudio inválida.');
    location = trusted;
  }
  const cachedFormat = location?.format;
  const session = createYoutubeSession(config.youtubeCookiesFile);
  const downloader = spawn(
    config.ytdlp,
    [
      '--ignore-config',
      '--compat-options',
      'prefer-legacy-http-handler',
      '--no-cache-dir',
      '--no-warnings',
      '--no-progress',
      '--js-runtimes',
      'node',
      '--no-playlist',
      ...session.args,
      ...(cachedFormat
        ? ['--load-info-json', '-', '-o', '-']
        : [
            '-f',
            'bestaudio/best',
            '-o',
            '-',
            '--',
            'https://www.youtube.com/watch?v=' + track.id,
          ]),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  downloader.stdin.on('error', () => {});
  if (cachedFormat && location)
    downloader.stdin.end(
      JSON.stringify({
        ...cachedFormat,
        id: track.id,
        title: track.title,
        url: location.url,
        http_headers: location.headers,
        extractor: 'youtube',
        extractor_key: 'Youtube',
        webpage_url: 'https://www.youtube.com/watch?v=' + track.id,
      }),
    );
  else downloader.stdin.end();
  const encoder = spawn(
    config.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-f',
      's16le',
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stopped = false,
    paused = false,
    lastData = Date.now(),
    received = false,
    failure = 'Não foi possível reproduzir esta música.';
  let downloaderDetails = '';
  downloader.stderr.on('data', (chunk: Buffer) => {
    downloaderDetails = (downloaderDetails + chunk.toString()).slice(-8192);
    failure = youtubeError(downloaderDetails, 'download').message;
  });
  encoder.stderr.on('data', (chunk: Buffer) => {
    if (failure === 'Não foi possível reproduzir esta música.')
      failure = youtubeError(chunk.toString(), 'download').message;
  });
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      if (!received) onReady?.(Math.round(performance.now() - startedAt));
      received = true;
      lastData = Date.now();
      callback(null, chunk);
    },
  });
  encoder.stdout.pipe(meter);
  const watchdog = setInterval(() => {
    if (!paused && Date.now() - lastData > (received ? 45000 : 30000)) fail();
  }, 5000);
  watchdog.unref();
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(watchdog);
    session.close();
    downloader.kill('SIGKILL');
    encoder.kill('SIGKILL');
    downloader.stdout.destroy();
    encoder.stdin.destroy();
    encoder.stdout.destroy();
    meter.destroy();
  }
  function fail() {
    if (stopped) return;
    stop();
    onError(new MusicError(502, failure));
  }
  downloader.on('error', (error) => {
    failure = youtubeError(
      String((error as NodeJS.ErrnoException).code),
      'download',
    ).message;
    fail();
  });
  encoder.on('error', (error) => {
    failure = youtubeError(
      String((error as NodeJS.ErrnoException).code),
      'download',
    ).message;
    fail();
  });
  downloader.on('close', (code) => {
    if (code && !stopped) fail();
  });
  encoder.on('close', (code) => {
    if (code && !stopped) fail();
  });
  encoder.stdin.on('error', () => {});
  downloader.stdout.pipe(encoder.stdin);
  return {
    stream: meter,
    stop,
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      lastData = Date.now();
    },
  };
}
