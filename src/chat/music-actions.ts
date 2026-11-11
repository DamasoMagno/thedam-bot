import type { ChatMessage } from './types.ts';
import type { PlayerService } from '../music/player-service.ts';
export function parseMusicCommand(text: string) {
  const match =
    /^\s*(?:\/(?:dam\s+)?tocar|!tocar|!play)\s+(?:musica:\s*)?(.{1,240})$/iu.exec(text);
  return match?.[1].trim() || null;
}
export function createGeneratedMusicActions(
  service: PlayerService,
  { now = Date.now } = {},
) {
  let busy = false,
    lastPlayed = -Infinity;
  return async (text: string, message: ChatMessage) => {
    const query = parseMusicCommand(text);
    if (!query || !message.guildId || busy || now() - lastPlayed < 10 * 60000) return;
    busy = true;
    try {
      const found = await service.run(message.guildId, message.author.id, 'search', {
        query,
        provider: 'youtube',
      });
      const track = found.tracks?.[0];
      if (!track) return;
      await service.run(message.guildId, message.author.id, 'enqueue', {
        token: track.token,
      });
      lastPlayed = now();
      await message.channel.send({
        content: 'Coloquei na fila: ' + track.title.slice(0, 100),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch {
      /* A missing call never causes retries or public error spam. */
    } finally {
      busy = false;
    }
  };
}
