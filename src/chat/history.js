import { safeText } from './model.js';

export const GENERAL_CHANNEL_ID = '1379585304029171805';
export const AMIGOS_GUILD_ID = '1379585303295299714';

export async function importGeneralHistory({
  channel,
  store,
  now = Date.now(),
  limit = 2000,
}) {
  if (channel.id !== GENERAL_CHANNEL_ID || channel.guildId !== AMIGOS_GUILD_ID)
    throw new Error('Importação permitida somente no geral do Amigos.');
  const cutoff = now - 30 * 86400000;
  let before,
    imported = 0,
    scanned = 0;
  while (imported < Math.min(limit, 2000)) {
    const page = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    if (!page.size) break;
    let oldest;
    for (const message of page.values()) {
      if (!oldest || BigInt(message.id) < BigInt(oldest.id)) oldest = message;
      scanned++;
      if (
        !Number.isFinite(message.createdTimestamp) ||
        message.createdTimestamp < cutoff
      )
        continue;
      if (
        message.author?.bot ||
        message.webhookId ||
        message.mentions?.users?.size ||
        message.mentions?.roles?.size ||
        message.mentions?.everyone
      )
        continue;
      const text = safeText(message.content);
      if (!text) continue;
      store.learn(message, text, message.createdTimestamp);
      imported++;
      if (imported >= Math.min(limit, 2000)) break;
    }
    if (!oldest || oldest.id === before || oldest.createdTimestamp < cutoff) break;
    before = oldest.id;
  }
  return { imported, scanned };
}
