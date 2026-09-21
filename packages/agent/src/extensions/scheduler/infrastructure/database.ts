/**
 * @author Codex
 * @description Open and migrate the daemon-owned SQLite connection before admitting scheduler work.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { SchedulerLifecycleError } from '../definitions/lifecycle.js';
import * as schema from './schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface SchedulerDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

/**
 * Open only while holding the profile lifecycle lease. Close the connection when any initialization step fails.
 */
export function openSchedulerDatabase(
  path: string,
  migrationsFolder = fileURLToPath(new URL('../../../assets/scheduler-migrations/', import.meta.url))
): SchedulerDatabase {
  let sqlite: Database.Database;
  try {
    sqlite = new Database(path);
  } catch (cause) {
    throw new SchedulerLifecycleError(
      'SCHEDULER_STORAGE_UNAVAILABLE',
      'Scheduler database cannot be opened',
      { cause }
    );
  }
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('synchronous = FULL');
    sqlite.pragma('busy_timeout = 5000');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    const checks: unknown = sqlite.pragma('foreign_key_check');
    if (!Array.isArray(checks) || checks.length !== 0) {
      throw new Error('Scheduler foreign key violation');
    }
    return { sqlite, db };
  } catch (cause) {
    sqlite.close();
    throw new SchedulerLifecycleError(
      'SCHEDULER_STORAGE_UNAVAILABLE',
      'Scheduler database initialization failed',
      { cause }
    );
  }
}
