import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function loadCatalogDatabase(path, catalog) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS catalog_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1), digest TEXT NOT NULL, details TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL,
        overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 100),
        club TEXT, nationality TEXT, primaryPosition TEXT
      );
    `);
    const { players, ...details } = catalog;
    const digest = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT digest FROM catalog_meta WHERE id = 1').get();
      if (existing?.digest !== digest) {
        db.exec('DELETE FROM players');
        const insert = db.prepare('INSERT INTO players VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const player of players) {
          insert.run(player.id, player.name, player.position, player.overall,
            player.club ?? null, player.nationality ?? null, player.primaryPosition ?? null);
        }
        db.prepare('INSERT OR REPLACE INTO catalog_meta VALUES (1, ?, ?)').run(digest, JSON.stringify(details));
      }
      const records = db.prepare('SELECT * FROM players ORDER BY id').all();
      db.exec('COMMIT');
      return { ...details, players: records };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}
