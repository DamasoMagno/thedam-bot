import test from 'node:test';
import assert from 'node:assert/strict';
import { LibraryRepository } from '../src/music/library-repository.ts';
const track = {
  id: 'abcdefghijk',
  provider: 'youtube',
  title: 'Teste',
  artist: 'Artista',
};
test('playlists persistem metadados, separam servidores e protegem edição/exclusão', () => {
  const db = new LibraryRepository(':memory:');
  const list = db.createPlaylist('amigos', 'ana', 'Rock', 'Rock', [track]);
  assert.equal(db.playlists('amigos')[0].count, 1);
  assert.equal(db.playlists('outro').length, 0);
  assert.throws(() => db.playlist('outro', list.id), /não encontrada/);
  assert.throws(
    () => db.addToPlaylist('amigos', 'bia', list.id, { ...track, id: 'lmnopqrstuv' }),
    /criador/,
  );
  db.addToPlaylist('amigos', 'bia', list.id, { ...track, id: 'lmnopqrstuv' }, true);
  assert.equal(db.playlist('amigos', list.id).tracks.length, 2);
  assert.throws(() => db.createPlaylist('amigos', 'ana', 'Rock', ''), /Já existe/);
  assert.throws(() => db.deletePlaylist('amigos', 'bia', list.id), /criador/);
  db.deletePlaylist('amigos', 'ana', list.id);
  assert.equal(db.playlists('amigos').length, 0);
  assert.equal(
    db.db.prepare('SELECT COUNT(*) AS n FROM music_playlist_tracks').get().n,
    0,
  );
  db.close();
});
test('favoritas são pessoais, idempotentes e o histórico é limitado a cinquenta entradas', () => {
  const db = new LibraryRepository(':memory:');
  db.favorite('amigos', 'ana', track);
  db.favorite('amigos', 'ana', track);
  assert.equal(db.favorites('amigos', 'ana').length, 1);
  assert.equal(db.favorites('amigos', 'bia').length, 0);
  for (let i = 0; i < 55; i++) db.record('amigos', track);
  assert.equal(db.history('amigos').length, 50);
  assert.equal(db.history('outro').length, 0);
  assert.throws(
    () => db.createPlaylist('amigos', 'ana', 'Cheia', '', Array(51).fill(track)),
    /50/,
  );
  db.close();
});
