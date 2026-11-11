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
) {
  if (!youtubeId(track.id)) throw new MusicError(400, 'Música inválida.');
  const downloader = spawn(
    config.ytdlp,
    [
      '--ignore-config',
      '--no-cache-dir',
      '--no-warnings',
      '--js-runtimes',
      'node',
      '--no-playlist',
      '-f',
      'bestaudio/best',
      '-o',
      '-',
      '--',
      'https://www.youtube.com/watch?v=' + track.id,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
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
  const diagnose = (chunk: Buffer) => {
    const text = chunk.toString().toLowerCase();
    if (text.includes('sign in') || text.includes('confirm you'))
      failure = 'O YouTube exigiu verificação para esta música.';
    else if (text.includes('not available') || text.includes('unavailable'))
      failure = 'Esta música não está disponível na fonte.';
    else if (text.includes('timed out') || text.includes('network'))
      failure = 'A conexão com a fonte de áudio falhou.';
  };
  downloader.stderr.on('data', diagnose);
  encoder.stderr.on('data', diagnose);
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
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
  downloader.on('error', fail);
  encoder.on('error', fail);
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
