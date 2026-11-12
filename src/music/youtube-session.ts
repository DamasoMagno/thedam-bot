import {
  mkdtempSync,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicError } from '../shared/music-error.ts';
export function createYoutubeSession(cookiesFile?: string) {
  if (!cookiesFile) return { args: [] as string[], close() {} };
  let directory: string | undefined;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(cookiesFile, 'r');
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > 4194304) throw new Error('invalid');
    const contents = readFileSync(descriptor, 'utf8')
      .replace(/^\uFEFF/u, '')
      .replace(/\r\n/g, '\n');
    if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)(?:\n|$)/u.test(contents))
      throw new Error('invalid');
    directory = mkdtempSync(join(tmpdir(), 'thedam-youtube-'));
    const temporary = join(directory, 'cookies.txt');
    writeFileSync(temporary, contents, { mode: 0o600 });
    const cleanup = directory;
    return {
      args: ['--cookies', temporary],
      close() {
        rmSync(cleanup, { recursive: true, force: true });
      },
    };
  } catch {
    if (directory) rmSync(directory, { recursive: true, force: true });
    throw new MusicError(
      503,
      'Não consegui ler os cookies do YouTube. Confira o arquivo Netscape e a permissão de leitura do container.',
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
