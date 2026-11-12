import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMusicCommand,
  createGeneratedMusicActions,
} from '../src/chat/music-actions.ts';
import { chooseReplyMedia, createReplyMediaPicker } from '../src/chat/media.ts';
test('comandos gerados só executam tocar reconhecido e respeitam a identidade de quem pediu', async () => {
  assert.equal(parseMusicCommand('/dam tocar musica:Queen'), 'Queen');
  assert.equal(parseMusicCommand('/parar'), null);
  const calls = [];
  const action = createGeneratedMusicActions({
    run: async (...args) => {
      calls.push(args);
      return args[2] === 'search'
        ? { tracks: [{ token: 'owned', title: 'Queen' }] }
        : {};
    },
  });
  const message = {
    guildId: 'amigos',
    author: { id: 'ana' },
    channel: { send: async () => ({ id: 'reply' }) },
  };
  await action('/tocar Queen', message);
  assert.equal(calls[1][2], 'enqueue');
  assert.equal(calls[1][1], 'ana');
  await action('/tocar Outra', message);
  assert.equal(calls.length, 2);
});
test('GIFs são opcionais e retornam no máximo uma mídia por resposta', () => {
  assert.equal(chooseReplyMedia({ chance: 0, random: () => 0 }), undefined);
  assert.equal(chooseReplyMedia({ chance: 1, random: () => 0 }).length, 1);
});

test('GIFs variam mesmo com sorteio igual e não repetem os últimos oito', () => {
  const picker = createReplyMediaPicker();
  const urls = Array.from(
    { length: 9 },
    () => picker({ chance: 1, random: () => 0 })[0].image.url,
  );
  assert.equal(new Set(urls).size, 9);
});

test('frequência padrão dos GIFs foi reduzida em trinta por cento', () => {
  assert.equal(createReplyMediaPicker()({ random: () => 0.2 }), undefined);
  assert.equal(createReplyMediaPicker()({ random: () => 0.17 }).length, 1);
});
