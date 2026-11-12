import { MusicError } from '../shared/music-error.ts';
export function youtubeError(
  details: unknown,
  phase: 'search' | 'download' = 'search',
) {
  const text = String(details).toLowerCase();
  const message =
    /sign in|confirm you.?re not a bot|login required|cookies.*(?:expired|invalid)/u.test(
      text,
    )
      ? 'O YouTube exigiu autenticação neste servidor. O administrador precisa configurar ou renovar os cookies do YouTube.'
      : /(?:http error|status(?: code)?|response code)[ :]*(?:403)|403 forbidden/u.test(
            text,
          )
        ? 'O YouTube recusou o acesso ao áudio (403). Verifique a sessão e as restrições do IP da VPS.'
        : /(?:http error|status(?: code)?)[ :]*429|too many requests/u.test(text)
          ? 'O YouTube limitou os pedidos deste servidor. Aguarde antes de tentar novamente.'
          : /enoent|not found|no such file/u.test(text)
            ? 'O executável de áudio não foi encontrado. Reconstrua a imagem Docker com yt-dlp e FFmpeg.'
            : /timed? ?out|eai_again|enotfound|enetunreach|network|temporary failure in name resolution/u.test(
                  text,
                )
              ? 'A VPS não conseguiu acessar a fonte de áudio. Confira DNS e as conexões de saída.'
              : /unavailable|not available|private video|has been removed/u.test(text)
                ? 'Esta música não está disponível no YouTube.'
                : phase === 'search'
                  ? 'Não foi possível consultar o YouTube agora.'
                  : 'Não foi possível reproduzir esta música.';
  return new MusicError(502, message);
}
