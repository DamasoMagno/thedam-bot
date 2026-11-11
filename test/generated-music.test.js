import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMusicCommand,
  createGeneratedMusicActions,
} from '../src/chat/music-actions.ts';
import { chooseReplyMedia } from '../src/chat/media.ts';
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
