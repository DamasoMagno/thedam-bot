import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicPanels, panelPayload, selection } from '../src/music/presentation.ts';
const state = {
  current: { title: 'Música', provider: 'youtube' },
  paused: false,
  queue: [],
  error: null,
};
test('painel é público, tem controles sem pings e não duplica sob cliques simultâneos', async () => {
  const sent = [],
    edits = [];
  const service = { state: () => state, onChange: () => () => {} };
  const channel = {
    id: 'chat',
    send: async (payload) => {
      sent.push(payload);
      return { channelId: 'chat', edit: async (value) => edits.push(value) };
    },
  };
  const panels = new MusicPanels({ service });
  await Promise.all([panels.show('amigos', channel), panels.show('amigos', channel)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].flags, undefined);
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  assert.equal(sent[0].components[0].components[0].custom_id, 'dam:pause');
  panels.close();
});
test('menus são paginados e mensagens não ultrapassam limite do Discord', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    label: 'Música ' + i,
    value: String(i),
  }));
  const page = selection('history', 'Música', items, 1);
  assert.equal(page[0].components[0].options.length, 20);
  assert.equal(page[0].components[0].options[0].value, '20');
  assert.equal(page[1].components[1].disabled, false);
  const payload = panelPayload({
    ...state,
    queue: Array(50).fill({ title: '*'.repeat(200) }),
  });
  assert.ok(payload.content.length < 2000);
});
