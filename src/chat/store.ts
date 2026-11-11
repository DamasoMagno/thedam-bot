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
    this.prune();
  }
  prune() {
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
    this.db.exec(
      'DELETE FROM messages WHERE id NOT IN(SELECT id FROM messages ORDER BY created DESC LIMIT 2000)',
    );
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
      'DELETE FROM messages;DELETE FROM favorites;DELETE FROM settings;DELETE FROM rejected;',
    );
  }
  close() {
    this.db.close();
  }
}
