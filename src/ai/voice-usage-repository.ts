import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class VoiceUsageRepository {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS voice_usage(day TEXT PRIMARY KEY,count INTEGER NOT NULL);',
    );
  }
  claim(limit: number, day = new Date().toISOString().slice(0, 10)) {
    const maximum = Math.max(0, Math.min(10, Math.floor(limit)));
    if (!maximum) return false;
    this.db
      .prepare('DELETE FROM voice_usage WHERE day < ?')
      .run(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
    return (
      this.db
        .prepare(
          'INSERT INTO voice_usage VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1 WHERE count<?',
        )
        .run(day, maximum).changes > 0
    );
  }
  remaining(limit: number, day = new Date().toISOString().slice(0, 10)) {
    const row = this.db.prepare('SELECT count FROM voice_usage WHERE day=?').get(day);
    return Math.max(0, Math.min(10, Math.floor(limit)) - Number(row?.count || 0));
  }
  close() {
    this.db.close();
  }
}
