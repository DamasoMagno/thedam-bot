import { MAX_LEARNED_MESSAGES } from './limits.ts';
import type { ChatMessage } from './types.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class ChatStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,author TEXT NOT NULL,text TEXT NOT NULL,created INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS favorites(id TEXT PRIMARY KEY,text TEXT NOT NULL,created INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS rejected(text TEXT PRIMARY KEY,created INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`,
    );
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS generated_messages(id TEXT PRIMARY KEY,text TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS message_votes(message TEXT NOT NULL REFERENCES generated_messages(id) ON DELETE CASCADE,user TEXT NOT NULL,vote TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(message,user));
      CREATE TABLE IF NOT EXISTS ai_usage(day TEXT PRIMARY KEY,count INTEGER NOT NULL);`);
    this.prune();
  }
  claimAiRequest(day: string, limit: number) {
    if (limit <= 0) return false;
    return (
      this.db
        .prepare(
          'INSERT INTO ai_usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<?',
        )
        .run(day, limit).changes > 0
    );
  }
  generated(id: string, text: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO generated_messages VALUES(?,?,?)')
      .run(id, text, Date.now());
    this.db.exec(
      'DELETE FROM generated_messages WHERE id NOT IN(SELECT id FROM generated_messages ORDER BY created DESC LIMIT 300)',
    );
  }
  generatedMessage(id: string) {
    const row = this.db
      .prepare('SELECT text,created FROM generated_messages WHERE id=?')
      .get(id);
    return row ? { text: String(row.text), at: Number(row.created) } : undefined;
  }
  vote(id: string, user: string, vote: string) {
    this.db
      .prepare(
        'INSERT INTO message_votes VALUES(?,?,?,?) ON CONFLICT(message,user) DO UPDATE SET vote=excluded.vote,created=excluded.created',
      )
      .run(id, user, vote, Date.now());
  }
  removeVote(id: string, user: string, vote: string) {
    this.db
      .prepare('DELETE FROM message_votes WHERE message=? AND user=? AND vote=?')
      .run(id, user, vote);
  }
  weeklyPearl() {
    const row = this.db
      .prepare(
        "SELECT g.id,g.text,SUM(CASE WHEN v.vote='👍' THEN 1 ELSE -1 END) AS score FROM generated_messages g JOIN message_votes v ON v.message=g.id WHERE g.created>=? GROUP BY g.id HAVING score>0 ORDER BY score DESC,g.created DESC LIMIT 1",
      )
      .get(Date.now() - 7 * 86400000);
    return row
      ? { id: String(row.id), text: String(row.text), score: Number(row.score) }
      : null;
  }
  favoriteEntries() {
    return this.db
      .prepare('SELECT id,text FROM favorites ORDER BY created DESC')
      .all()
      .map((row) => ({ id: String(row.id), text: String(row.text) }));
  }
  prune() {
    this.db
      .prepare('DELETE FROM generated_messages WHERE created<?')
      .run(Date.now() - 30 * 86400000);
    this.db
      .prepare('DELETE FROM ai_usage WHERE day<?')
      .run(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    this.db
      .prepare('DELETE FROM messages WHERE created < ?')
      .run(Date.now() - 30 * 86400000);
  }
  learn(
    message: Pick<ChatMessage, 'id' | 'author'>,
    text: string,
    createdAt = Date.now(),
  ) {
    this.db
      .prepare('INSERT OR REPLACE INTO messages VALUES(?,?,?,?)')
      .run(message.id, message.author.id, text, createdAt);
    this.db
      .prepare('DELETE FROM messages WHERE created < ?')
      .run(Date.now() - 30 * 86400000);
    this.db
      .prepare(
        'DELETE FROM messages WHERE id NOT IN(SELECT id FROM messages ORDER BY created DESC LIMIT ?)',
      )
      .run(MAX_LEARNED_MESSAGES);
  }
  unReject(text: string) {
    this.db.prepare('DELETE FROM rejected WHERE text=?').run(text);
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM messages WHERE id=?').run(id);
  }
  texts() {
    this.prune();
    return this.db
      .prepare('SELECT text FROM messages')
      .all()
      .map((row) => String(row.text));
  }
  olderTexts(before: number) {
    this.prune();
    return this.db
      .prepare('SELECT text FROM messages WHERE created < ? ORDER BY created ASC')
      .all(before)
      .map((row) => String(row.text));
  }
  remember(id: string, text: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO favorites VALUES(?,?,?)')
      .run(id, text, Date.now());
    this.db.exec(
      'DELETE FROM favorites WHERE id NOT IN(SELECT id FROM favorites ORDER BY created DESC LIMIT 100)',
    );
  }
  forget(id: string) {
    this.db.prepare('DELETE FROM favorites WHERE id=?').run(id);
  }
  favorites() {
    return this.db
      .prepare('SELECT text FROM favorites ORDER BY created DESC')
      .all()
      .map((row) => String(row.text));
  }
  reject(id: string, text: string) {
    this.forget(id);
    this.db
      .prepare('INSERT OR REPLACE INTO rejected VALUES(?,?)')
      .run(text, Date.now());
    this.db.exec(
      'DELETE FROM rejected WHERE text NOT IN(SELECT text FROM rejected ORDER BY created DESC LIMIT 100)',
    );
  }
  rejected() {
    return this.db
      .prepare('SELECT text FROM rejected')
      .all()
      .map((row) => String(row.text));
  }
  frequent() {
    this.prune();
    return this.db
      .prepare(
        'SELECT author FROM messages GROUP BY author HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC LIMIT 5',
      )
      .all()
      .map((row) => String(row.author));
  }
  setting(key: string, value?: string | boolean) {
    if (value !== undefined)
      this.db
        .prepare('INSERT OR REPLACE INTO settings VALUES(?,?)')
        .run(key, String(value));
    return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value as
      string | undefined;
  }
  clear() {
    this.db.exec(
      'DELETE FROM messages;DELETE FROM favorites;DELETE FROM settings;DELETE FROM rejected;DELETE FROM generated_messages;',
    );
  }
  close() {
    this.db.close();
  }
}
