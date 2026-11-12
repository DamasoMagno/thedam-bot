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
  assert.equal(sent[0].components[0].components[0].custom_id, 'dam:addMusic');
  assert.ok(
    sent[0].components[0].components.some((item) => item.custom_id === 'dam:pause'),
  );
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

test('fila apresenta ações claras e desativa movimentos nas extremidades', async () => {
  const { queuePayload } = await import('../src/music/presentation.ts');
  const queue = Array.from({ length: 50 }, (_, i) => ({
    title: '*'.repeat(200),
    queueId: 'id-' + i,
  }));
  const first = queuePayload({ ...state, queue }, { selectedId: 'id-0' });
  assert.equal(
    first.components
      .flatMap((row) => row.components)
      .find((item) => item.custom_id?.startsWith('dam:moveUp:')).label,
    'Subir',
  );
  assert.equal(
    first.components
      .flatMap((row) => row.components)
      .find((item) => item.custom_id?.startsWith('dam:moveUp:')).disabled,
    true,
  );
  assert.equal(
    first.components
      .flatMap((row) => row.components)
      .find((item) => item.custom_id?.startsWith('dam:moveDown:')).disabled,
    false,
  );
  assert.ok(first.content.length < 2000);
  const last = queuePayload({ ...state, queue }, { selectedId: 'id-49' });
  assert.equal(
    last.components
      .flatMap((row) => row.components)
      .find((item) => item.custom_id?.startsWith('dam:moveDown:')).disabled,
    true,
  );
  assert.equal(last.components[0].components[0].options[0].value, 'id-40');
  assert.throws(
    () => queuePayload({ ...state, queue }, { selectedId: 'missing' }),
    /não está mais/,
  );
});

test('painel inclui acesso direto às playlists e respeita limites de componentes', () => {
  const lists = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    name: 'Lista ' + i,
    count: 10,
  }));
  const payload = panelPayload(state, lists);
  assert.ok(payload.components.length <= 5);
  const menu = payload.components
    .flatMap((row) => row.components)
    .find((item) => item.custom_id === 'dam:playPlaylist');
  assert.equal(menu.options.length, 20);
  assert.ok(payload.components[0].components.length <= 5);
});

test('voz opcional e trinta playlists cabem nos limites do painel Discord', () => {
  const lists = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    name: 'Lista ' + i,
    count: 5,
  }));
  const payload = panelPayload(state, lists, true);
  assert.ok(payload.components.length <= 5);
  assert.ok(
    payload.components
      .flatMap((row) => row.components)
      .some((item) => item.custom_id === 'dam:voiceCommand'),
  );
  const disabled = panelPayload(state, lists, false);
  assert.ok(
    !disabled.components
      .flatMap((row) => row.components)
      .some((item) => item.custom_id === 'dam:voiceCommand'),
  );
});

test('playlist de outra pessoa permite tocar mas desativa os controles de edição', async () => {
  const { playlistDetailPayload } =
    await import('../src/music/playlist-presentation.ts');
  const payload = playlistDetailPayload(
    { id: 'list', name: 'Rock', tracks: [{ title: 'Queen' }] },
    false,
  );
  const buttons = payload.components[0].components;
  assert.equal(buttons[0].disabled, false);
  assert.ok(buttons.slice(1).every((button) => button.disabled));
});
