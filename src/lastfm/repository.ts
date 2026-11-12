import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export interface LastFmAccount {
  user: string;
  name: string;
  session: string;
}
export interface Scrobble {
  artist: string;
  track: string;
  duration: number;
  timestamp: number;
  chosenByUser: string;
}
export class LastFmRepository {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(path: string, secret: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.key = createHash('sha256')
      .update('thedam:lastfm:' + secret)
      .digest();
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS accounts(user TEXT PRIMARY KEY,name TEXT NOT NULL,session TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scrobbles(id TEXT PRIMARY KEY,user TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0);`);
  }
  private encrypt(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  }
  private decrypt(value: string) {
    const data = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
      'utf8',
    );
  }
  account(user: string): LastFmAccount | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE user=?').get(user);
    if (!row) return;
    return { user, name: String(row.name), session: this.decrypt(String(row.session)) };
  }
  save(user: string, name: string, session: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM scrobbles WHERE user=?').run(user);
      this.db
        .prepare(
          'INSERT INTO accounts VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET name=excluded.name,session=excluded.session',
        )
        .run(user, name, this.encrypt(session));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  remove(user: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM accounts WHERE user=?').run(user);
      this.db.prepare('DELETE FROM scrobbles WHERE user=?').run(user);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  users() {
    return this.db
      .prepare('SELECT user FROM accounts')
      .all()
      .map((row) => String(row.user));
  }
  enqueue(id: string, user: string, payload: Scrobble, now = Date.now()) {
    this.db.prepare('DELETE FROM scrobbles WHERE created<?').run(now - 7 * 86400000);
    if (!this.account(user)) return false;
    if (
      Number(
        this.db.prepare('SELECT count(*) AS count FROM scrobbles WHERE done=0').get()
          ?.count,
      ) >= 500
    )
      return false;
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO scrobbles(id,user,payload,created) VALUES(?,?,?,?)',
        )
        .run(id, user, JSON.stringify(payload), now).changes > 0
    );
  }
  due(now = Date.now()) {
    this.db.prepare('DELETE FROM scrobbles WHERE created<?').run(now - 7 * 86400000);
    return this.db
      .prepare(
        'SELECT * FROM scrobbles WHERE done=0 AND next<=? ORDER BY created LIMIT 10',
      )
      .all(now)
      .map((row) => ({
        id: String(row.id),
        user: String(row.user),
        attempts: Number(row.attempts),
        payload: JSON.parse(String(row.payload)) as Scrobble,
      }));
  }
  complete(id: string) {
    this.db.prepare("UPDATE scrobbles SET done=1,payload='{}' WHERE id=?").run(id);
  }
  retry(id: string, attempts: number, now = Date.now()) {
    if (attempts >= 5) return this.complete(id);
    this.db
      .prepare('UPDATE scrobbles SET attempts=?,next=? WHERE id=?')
      .run(attempts, now + Math.min(3600000, 60000 * 2 ** attempts), id);
  }
  close() {
    this.db.close();
  }
}
