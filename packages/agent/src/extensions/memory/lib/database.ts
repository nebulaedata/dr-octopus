/**
 * @author Codex
 * @description Lazy memory SQLite connections and serialized Drizzle migration initialization.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { tryAcquireProcessLock } from '../../../lib/daemon-platform/singleton-lease.js';
import { MemoryError } from '../definitions/error.js';
import * as schema from './schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
export interface MemoryDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}
/**
 * Select source migration history for tsx development and bundled assets for compiled releases.
 * A missing release asset must still fail instead of silently using a checkout's migration history.
 */
function defaultMigrationsFolder(): string {
  const relativePath = new URL(import.meta.url).pathname.endsWith('.ts')
    ? '../../../../drizzle/memory/'
    : '../../../assets/memory-migrations/';
  return fileURLToPath(new URL(relativePath, import.meta.url));
}
/**
 * Open an existing database without filesystem mutations, or initialize under the process lock.
 */
export async function openMemoryDatabase(
  directory: string,
  create: boolean,
  migrationsFolder = defaultMigrationsFolder()
): Promise<MemoryDatabase | undefined> {
  const databasePath = join(directory, 'memory.db');
  if (!create) {
    try {
      await access(databasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
  } else {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  let lock: Awaited<ReturnType<typeof tryAcquireProcessLock>> = null;
  let sqlite: Database.Database | undefined;
  try {
    if (create) {
      for (let attempt = 0; attempt < 30 && !lock; attempt++) {
        lock = await tryAcquireProcessLock(join(directory, 'migration.lock'));
        if (!lock) {
          await delay(30);
        }
      }
      if (!lock) {
        throw new MemoryError('STORE_UNAVAILABLE', '记忆数据库正在升级，请稍后重试。');
      }
    }
    // Bound synchronous lock waits on the Host thread; the repository retries asynchronously.
    sqlite = new Database(databasePath, { readonly: !create, fileMustExist: !create, timeout: 50 });
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    if (create) {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('synchronous = FULL');
      migrate(db, { migrationsFolder });
      db.insert(schema.memoryMeta)
        .values({ id: 1, storeId: randomUUID(), mode: 'auto' })
        .onConflictDoNothing()
        .run();
    }
    return { sqlite, db };
  } catch (error) {
    sqlite?.close();
    throw error;
  } finally {
    lock?.release();
  }
}
