export type VoiceIntent =
  | { action: 'playlist'; name: string }
  | { action: 'play'; query: string }
  | { action: 'pause' | 'resume' | 'skip' };
export function parseVoiceIntent(value: string): VoiceIntent | null {
  const text = value
    .normalize('NFKC')
    .trim()
    .replace(/^["“”]+|["“”]+$/gu, '');
  const match = /^(?:the\s*dam|te\s*dam|dam)[\s,:!.-]+(.+)$/iu.exec(text);
  if (!match) return null;
  const command = match[1].trim().replace(/[.!?]+$/u, '');
  const play =
    /^(?:tocar|toque|toca|coloca|coloque|reproduza)\s+(?:(?:a\s+)?m[uú]sica\s+)?(.{1,180})$/iu.exec(
      command,
    );
  if (play) {
    const playlist = /^playlist\s+(.{1,60})$/iu.exec(play[1].trim());
    if (playlist) return { action: 'playlist', name: playlist[1].trim() };
    return { action: 'play', query: play[1].trim() };
  }
  if (/^(?:pausar|pause|pausa)$/iu.test(command)) return { action: 'pause' };
  if (/^(?:continuar|continue|continua|retomar)$/iu.test(command))
    return { action: 'resume' };
  if (/^(?:pular|pule|pula)(?:\s+(?:a\s+)?m[uú]sica)?$/iu.test(command))
    return { action: 'skip' };
  return null;
}
