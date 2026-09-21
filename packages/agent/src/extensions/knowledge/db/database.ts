/**
 * @author Codex
 * @description Open only the singleton owner's control database and apply generated Drizzle migrations.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface KnowledgeDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

/**
 * Fail startup and close the handle if migrations or connection initialization fail.
 */
export function openKnowledgeDatabase(
  path: string,
  migrationsFolder = fileURLToPath(new URL('../../../assets/knowledge-migrations/', import.meta.url))
): KnowledgeDatabase {
  const sqlite = new Database(path);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('synchronous = FULL');
    sqlite.pragma('busy_timeout = 5000');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    return { sqlite, db };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
