/**
 * @author Codex
 * @description Persists grants with short SQLite transactions, CAS revocation and read-only runner access.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { PermissionGrantError } from '../definitions/grant.js';
import { grantAudit, permissionGrants } from './grant-schema.js';
import type { GrantBinding, GrantRepository, PermissionGrant } from '../definitions/grant.js';
import type { TaskToolCapability } from '@octopus/shared/protocol/scheduled-tasks';

/**
 * Open a permission-owned database; only the daemon control composition may migrate it.
 */
export function openGrantRepository(agentDir: string, readonly = false): GrantRepository {
  const path = join(dirname(realpathSync(agentDir)), 'permission-system', 'grants.db');
  if (!readonly) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path, { readonly, fileMustExist: readonly, timeout: 5000 });
  const db = drizzle(sqlite);
  try {
    sqlite.pragma('foreign_keys = ON');
    if (!readonly) {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('synchronous = FULL');
      migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../../../assets/permission-migrations/', import.meta.url)),
      });
    }
    // Preparing the known schema fails closed on missing or incompatible storage.
    db.select().from(permissionGrants).limit(0).all();
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return {
    get(id) {
      return db.select().from(permissionGrants).where(eq(permissionGrants.id, id)).get();
    },
    approve(binding: GrantBinding, tools: TaskToolCapability[], operationId: string): PermissionGrant {
      return sqlite
        .transaction(() => {
          const previous = db
            .select()
            .from(permissionGrants)
            .where(eq(permissionGrants.operationId, operationId))
            .get();
          if (previous) {
            if (
              Object.entries(binding).some(([key, value]) => previous[key as keyof GrantBinding] !== value) ||
              JSON.stringify(previous.tools) !== JSON.stringify(tools)
            ) {
              throw new PermissionGrantError(
                'SCHEDULE_TASK_CONFLICT',
                'Approval operation has different content'
              );
            }
            return previous;
          }
          const replaced = db
            .select()
            .from(permissionGrants)
            .where(
              and(
                eq(permissionGrants.profileId, binding.profileId),
                eq(permissionGrants.subjectId, binding.subjectId),
                eq(permissionGrants.state, 'active')
              )
            )
            .all();
          for (const old of replaced) {
            db.update(permissionGrants)
              .set({ state: 'revoked', revision: old.revision + 1 })
              .where(eq(permissionGrants.id, old.id))
              .run();
            db.insert(grantAudit)
              .values({
                id: randomUUID(),
                grantId: old.id,
                action: 'revoked',
                actor: 'user',
                at: new Date().toISOString(),
              })
              .run();
          }
          const grant = db
            .insert(permissionGrants)
            .values({
              ...binding,
              tools,
              operationId,
              id: randomUUID(),
              approvedAt: new Date().toISOString(),
            })
            .returning()
            .get();
          db.insert(grantAudit)
            .values({
              id: randomUUID(),
              grantId: grant.id,
              action: 'approved',
              actor: 'user',
              at: grant.approvedAt,
            })
            .run();
          return grant;
        })
        .immediate();
    },
    revoke(id, revision) {
      sqlite
        .transaction(() => {
          const grant = db.select().from(permissionGrants).where(eq(permissionGrants.id, id)).get();
          if (!grant || grant.state === 'revoked') {
            return;
          }
          if (grant.revision !== revision) {
            throw new PermissionGrantError('SCHEDULE_TASK_CONFLICT', 'Grant revision changed');
          }
          db.update(permissionGrants)
            .set({ state: 'revoked', revision: revision + 1 })
            .where(eq(permissionGrants.id, id))
            .run();
          db.insert(grantAudit)
            .values({
              id: randomUUID(),
              grantId: id,
              action: 'revoked',
              actor: 'user',
              at: new Date().toISOString(),
            })
            .run();
        })
        .immediate();
    },
    close() {
      sqlite.close();
    },
  };
}
