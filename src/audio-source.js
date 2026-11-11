import { spawn } from 'node:child_process';
import { youtubeId } from './catalog.js';
import { MusicError } from './error.js';
export function createAudioSource(config, track, onError) {
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
    { stdio: ['ignore', 'pipe', 'ignore'] },
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
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let stopped = false;
  const timeout = setTimeout(() => fail(), 30000);
  timeout.unref();
  encoder.stdout.once('data', () => clearTimeout(timeout));
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    downloader.kill('SIGKILL');
    encoder.kill('SIGKILL');
    downloader.stdout.destroy();
    encoder.stdin.destroy();
    encoder.stdout.destroy();
  }
  function fail() {
    if (stopped) return;
    stop();
    onError(new MusicError(502, 'Não foi possível reproduzir esta música.'));
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
  return { stream: encoder.stdout, stop };
}
