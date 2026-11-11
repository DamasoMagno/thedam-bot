export function configuration(env = process.env) {
  if (!env.DISCORD_BOT_TOKEN) throw new Error('Preencha DISCORD_BOT_TOKEN.');
  if (!/^[a-f0-9]{64}$/i.test(env.MUSIC_SHARED_SECRET || ''))
    throw new Error('MUSIC_SHARED_SECRET deve ter 64 caracteres hexadecimais.');
  const port = Number(env.PORT || 3031);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT inválida.');
  const aiProvider =
    env.AI_PROVIDER || (env.OPENROUTER_API_KEY ? 'openrouter' : 'openai');
  if (!['openai', 'openrouter'].includes(aiProvider))
    throw new Error('AI_PROVIDER deve ser openai ou openrouter.');
  const openrouterModel = env.OPENROUTER_MODEL || 'openrouter/free';
  if (
    aiProvider === 'openrouter' &&
    openrouterModel !== 'openrouter/free' &&
    !openrouterModel.endsWith(':free')
  )
    throw new Error('Use openrouter/free ou um modelo terminado em :free.');
  return {
    aiProvider: aiProvider as 'openai' | 'openrouter',
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterModel,
    mediaChance: Math.max(0, Math.min(1, Number(env.MARKOV_MEDIA_CHANCE || 0.25) || 0)),
    openaiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-6-luna',
    openaiChance: Math.max(
      0,
      Math.min(1, Number(env.OPENAI_REPLY_CHANCE || 0.15) || 0),
    ),
    openaiDailyLimit: Math.max(
      0,
      Math.min(200, Number(env.OPENAI_DAILY_LIMIT || 30) || 0),
    ),
    markovEnabled: env.MARKOV_ENABLED === 'true',
    markovChannel: env.MARKOV_CHANNEL_ID || '',
    musicPath: env.MUSIC_DB_PATH || '/app/data/music.sqlite',
    markovPath: env.MARKOV_DB_PATH || '/app/data/markov.sqlite',
    token: env.DISCORD_BOT_TOKEN,
    secret: env.MUSIC_SHARED_SECRET,
    host: env.HOST || '127.0.0.1',
    port,
    spotifyId: env.SPOTIFY_CLIENT_ID || '',
    spotifySecret: env.SPOTIFY_CLIENT_SECRET || '',
    ytdlp: env.YTDLP_PATH || 'yt-dlp',
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    emptyMs: Math.max(1000, Number(env.EMPTY_TIMEOUT_MS) || 60000),
  };
}
