import type { Track, PlaylistSummary, Playlist, LibraryEntry } from './types.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MusicError } from '../shared/music-error.ts';

export class LibraryRepository {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS music_playlists(id TEXT PRIMARY KEY,guild TEXT NOT NULL,owner TEXT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(guild,name));
      CREATE TABLE IF NOT EXISTS music_playlist_tracks(playlist TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,position INTEGER NOT NULL,track TEXT NOT NULL,PRIMARY KEY(playlist,position));
      CREATE TABLE IF NOT EXISTS music_favorites(id TEXT PRIMARY KEY,guild TEXT NOT NULL,user TEXT NOT NULL,track_key TEXT NOT NULL,track TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(guild,user,track_key));
      CREATE TABLE IF NOT EXISTS music_history(id TEXT PRIMARY KEY,guild TEXT NOT NULL,track TEXT NOT NULL,created INTEGER NOT NULL);
      PRAGMA foreign_keys=ON; PRAGMA user_version=1;`);
  }
  playlists(guild: string): PlaylistSummary[] {
    return this.db
      .prepare(
        'SELECT p.id,p.name,p.category,p.owner,COUNT(t.position) AS count FROM music_playlists p LEFT JOIN music_playlist_tracks t ON t.playlist=p.id WHERE p.guild=? GROUP BY p.id ORDER BY p.created DESC',
      )
      .all(guild) as unknown as PlaylistSummary[];
  }
  playlist(guild: string, id: string): Playlist {
    const row = this.db
      .prepare('SELECT * FROM music_playlists WHERE guild=? AND id=?')
      .get(guild, id) as unknown as Omit<Playlist, 'tracks'> | undefined;
    if (!row) throw new MusicError(404, 'Playlist não encontrada.');
    return {
      ...row,
      tracks: this.db
        .prepare(
          'SELECT track FROM music_playlist_tracks WHERE playlist=? ORDER BY position',
        )
        .all(id)
        .map((row) => JSON.parse(String(row.track)) as Track),
    };
  }
  createPlaylist(
    guild: string,
    user: string,
    name: unknown,
    category: unknown,
    tracks: Track[] = [],
  ) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 60 ||
      (category && (typeof category !== 'string' || category.length > 40))
    )
      throw new MusicError(
        400,
        'Use um nome de até 60 caracteres e categoria de até 40.',
      );
    if (this.playlists(guild).length >= 30)
      throw new MusicError(409, 'O servidor já tem 30 playlists.');
    if (tracks.length > 50)
      throw new MusicError(409, 'Cada playlist aceita até 50 músicas.');
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO music_playlists VALUES(?,?,?,?,?,?)')
        .run(
          id,
          guild,
          user,
          name.trim(),
          typeof category === 'string' ? category.trim() || 'Geral' : 'Geral',
          Date.now(),
        );
      const insert = this.db.prepare('INSERT INTO music_playlist_tracks VALUES(?,?,?)');
      tracks.forEach((track, index) =>
        insert.run(id, index, JSON.stringify(this.cleanTrack(track))),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      if (String(error instanceof Error ? error.message : '').includes('UNIQUE'))
        throw new MusicError(409, 'Já existe uma playlist com esse nome.');
      throw error;
    }
    return this.playlist(guild, id);
  }
  addToPlaylist(guild: string, user: string, id: string, track: Track, admin = false) {
    const list = this.playlist(guild, id);
    if (list.owner !== user && !admin)
      throw new MusicError(
        403,
        'Só o criador ou um administrador pode editar a playlist.',
      );
    if (list.tracks.length >= 50) throw new MusicError(409, 'A playlist está cheia.');
    const clean = this.cleanTrack(track);
    if (
      list.tracks.some(
        (item) => item.id === clean.id && item.provider === clean.provider,
      )
    )
      throw new MusicError(409, 'Esta música já está na playlist.');
    this.db
      .prepare('INSERT INTO music_playlist_tracks VALUES(?,?,?)')
      .run(id, list.tracks.length, JSON.stringify(clean));
    return this.playlist(guild, id);
  }
  deletePlaylist(guild: string, user: string, id: string, admin = false) {
    const list = this.playlist(guild, id);
    if (list.owner !== user && !admin)
      throw new MusicError(
        403,
        'Só o criador ou um administrador pode excluir a playlist.',
      );
    this.db.prepare('DELETE FROM music_playlists WHERE id=?').run(id);
  }
  cleanTrack(track: Track): Track {
    if (
      !track ||
      !['youtube', 'spotify'].includes(track.provider) ||
      !(
        (/^[a-zA-Z0-9_-]{11}$/.test(track.id) && track.provider === 'youtube') ||
        (/^[a-zA-Z0-9]{22}$/.test(track.id) && track.provider === 'spotify')
      )
    )
      throw new MusicError(400, 'Música inválida.');
    return {
      id: track.id,
      provider: track.provider,
      title: String(track.title || 'Música').slice(0, 200),
      artist: String(track.artist || '').slice(0, 160),
      duration: Number.isFinite(track.duration) ? track.duration : null,
    };
  }
  favorite(guild: string, user: string, track: Track) {
    const clean = this.cleanTrack(track);
    this.db
      .prepare(
        'INSERT INTO music_favorites VALUES(?,?,?,?,?,?) ON CONFLICT(guild,user,track_key) DO UPDATE SET track=excluded.track,created=excluded.created',
      )
      .run(
        randomUUID(),
        guild,
        user,
        clean.provider + ':' + clean.id,
        JSON.stringify(clean),
        Date.now(),
      );
    this.db
      .prepare(
        'DELETE FROM music_favorites WHERE guild=? AND user=? AND id NOT IN(SELECT id FROM music_favorites WHERE guild=? AND user=? ORDER BY created DESC LIMIT 100)',
      )
      .run(guild, user, guild, user);
    return this.favorites(guild, user);
  }
  favorites(guild: string, user: string): LibraryEntry[] {
    return this.db
      .prepare(
        'SELECT id,track FROM music_favorites WHERE guild=? AND user=? ORDER BY created DESC',
      )
      .all(guild, user)
      .map((row) => ({
        id: String(row.id),
        track: JSON.parse(String(row.track)) as Track,
      }));
  }
  record(guild: string, track: Track) {
    this.db
      .prepare('INSERT INTO music_history VALUES(?,?,?,?)')
      .run(randomUUID(), guild, JSON.stringify(this.cleanTrack(track)), Date.now());
    this.db
      .prepare(
        'DELETE FROM music_history WHERE guild=? AND id NOT IN(SELECT id FROM music_history WHERE guild=? ORDER BY created DESC LIMIT 50)',
      )
      .run(guild, guild);
  }
  history(guild: string): LibraryEntry[] {
    return this.db
      .prepare('SELECT id,track FROM music_history WHERE guild=? ORDER BY created DESC')
      .all(guild)
      .map((row) => ({
        id: String(row.id),
        track: JSON.parse(String(row.track)) as Track,
      }));
  }
  close() {
    this.db.close();
  }
}
