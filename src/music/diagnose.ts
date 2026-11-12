import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { generateDependencyReport } from '@discordjs/voice';
import { configuration } from '../config/index.ts';
import { MusicError } from '../shared/music-error.ts';
import { Catalog, parseQuery } from './catalog.ts';
import { createAudioSource } from './audio-source.ts';
import { createYoutubeSession } from './youtube-session.ts';
export async function diagnoseMusic(
  config: ReturnType<typeof configuration>,
  query?: string,
) {
  for (const [name, binary, args] of [
    ['yt-dlp', config.ytdlp, ['--version']],
    ['FFmpeg', config.ffmpeg, ['-version']],
  ] as const) {
    try {
      console.log(
        name +
          ': ' +
          execFileSync(binary, [...args], {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
            .toString()
            .split('\n')[0]
            .slice(0, 200),
      );
    } catch {
      throw new MusicError(503, name + ' indisponível. Reconstrua a imagem Docker.');
    }
  }
  console.log(generateDependencyReport());
  const session = createYoutubeSession(config.youtubeCookiesFile);
  session.close();
  console.log(
    'Cookies YouTube: ' +
      (config.youtubeCookiesFile
        ? 'arquivo legível e formato válido (sessão ainda não verificada)'
        : 'não configurados'),
  );
  if (!query) return;
  if (!parseQuery(query).video)
    throw new MusicError(
      400,
      'Para testar a fonte, informe um link direto de vídeo do YouTube.',
    );
  const startedAt = performance.now();
  const catalog = new Catalog(config);
  const tracks = await catalog.search(query);
  if (!tracks[0]) throw new MusicError(404, 'Não encontrei esse vídeo no YouTube.');
  const location = await catalog.audioLocation(tracks[0]);
  let cleanup: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    const source = createAudioSource(config, tracks[0], reject, { location });
    const timeout = setTimeout(
      () => reject(new MusicError(504, 'A fonte não entregou áudio em 40 segundos.')),
      40000,
    );
    source.stream.once('data', () => resolve());
    source.stream.once('error', reject);
    source.stream.once('end', () =>
      reject(new MusicError(502, 'A fonte encerrou sem áudio.')),
    );
    // Both failures and success release processes and private temporary cookies.
    const dispose = () => {
      clearTimeout(timeout);
      source.stop();
    };
    source.stream.once('data', dispose);
    source.stream.once('close', () => {
      clearTimeout(timeout);
    });
    // Keep the disposer available until the outer promise settles.
    cleanup = dispose;
  }).finally(() => {
    cleanup?.();
  });
  console.log(
    'Fonte YouTube: áudio PCM recebido em ' +
      Math.round(performance.now() - startedAt) +
      ' ms.',
  );
  console.log(
    'Este teste não entra em call. Se passar e o Discord continuar sem áudio, confira permissões, saída UDP e o diagnóstico de voz acima.',
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await diagnoseMusic(configuration(), process.argv[2]);
  } catch (error) {
    console.error(
      error instanceof MusicError
        ? error.message
        : 'Falha no diagnóstico musical. Confira as ferramentas e a configuração.',
    );
    process.exitCode = 1;
  }
}
