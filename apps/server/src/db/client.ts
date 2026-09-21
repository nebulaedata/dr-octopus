/**
 * @author Codex
 * @description 创建控制面 SQLite 连接并通过 Drizzle 官方 migrator 应用版本化 schema
 */

import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

export interface OctopusDatabase {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
}

/**
 * Resolves committed migrations in source development and migration assets in compiled builds.
 *
 * @returns Absolute path to the Server migration resource directory.
 */
function resolveMigrationsFolder(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const codeRoot = dirname(moduleDirectory);
  return basename(codeRoot) === 'dist'
    ? join(codeRoot, 'assets', 'server-migrations')
    : join(dirname(codeRoot), 'drizzle');
}

const migrationsFolder = resolveMigrationsFolder();

/**
 * 创建数据库并通过 Drizzle 官方 migrator 应用尚未执行的版本化迁移。
 *
 * @param path SQLite 文件路径，`:memory:` 用于测试
 * @returns 已完成官方迁移并启用安全 PRAGMA 的数据库连接
 * @throws 当迁移或外键完整性校验失败时关闭连接并抛出错误
 */
export function createDatabase(path: string): OctopusDatabase {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = FULL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  try {
    migrate(db, { migrationsFolder });
    const foreignKeyViolations = sqlite.pragma('foreign_key_check') as unknown[];
    if (foreignKeyViolations.length > 0) {
      throw new Error('Database foreign key validation failed.');
    }
    return { db, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
