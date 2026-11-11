import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType } from 'discord.js';
import { DiscordGateway } from '../src/discord/gateway.ts';
test('autorização consulta o canal real e aceita apenas calls de voz com permissões', async (t) => {
  const gateway = new DiscordGateway({ emptyMs: 1000 });
  t.after(() => gateway.close());
  const channel = {
    id: '300000000000000001',
    type: ChannelType.GuildVoice,
    permissionsFor: () => ({ has: () => true }),
  };
  const member = { voice: { channel } };
  gateway.client.guilds.cache.set('200000000000000001', {
    members: { fetch: async () => member, me: {} },
  });
  assert.equal(
    await gateway.authorize('200000000000000001', '100000000000000001'),
    channel.id,
  );
  channel.type = ChannelType.GuildStageVoice;
  await assert.rejects(
    gateway.authorize('200000000000000001', '100000000000000001'),
    (e) => e.status === 409,
  );
  channel.type = ChannelType.GuildVoice;
  channel.permissionsFor = () => ({ has: () => false });
  await assert.rejects(
    gateway.authorize('200000000000000001', '100000000000000001'),
    (e) => e.status === 403,
  );
  member.voice.channel = null;
  await assert.rejects(
    gateway.authorize('200000000000000001', '100000000000000001'),
    (e) => e.status === 409,
  );
});
