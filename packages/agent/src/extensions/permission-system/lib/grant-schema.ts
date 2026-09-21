/**
 * @author Codex
 * @description Owns durable permission grants and transactional approval audit tables.
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TaskToolCapability } from '@octopus/shared/protocol/scheduled-tasks';

export const permissionGrants = sqliteTable('permission_grants', {
  id: text('id').primaryKey(),
  schemaVersion: integer('schema_version').notNull().default(1),
  profileId: text('profile_id').notNull(),
  subjectId: text('subject_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  executionDigest: text('execution_digest').notNull(),
  revision: integer('revision').notNull().default(1),
  state: text('state', { enum: ['active', 'revoked'] })
    .notNull()
    .default('active'),
  tools: text('tools', { mode: 'json' }).$type<TaskToolCapability[]>().notNull(),
  operationId: text('operation_id').notNull().unique(),
  approvedAt: text('approved_at').notNull(),
});
export const grantAudit = sqliteTable('permission_grant_audit', {
  id: text('id').primaryKey(),
  schemaVersion: integer('schema_version').notNull().default(1),
  grantId: text('grant_id')
    .notNull()
    .references(() => permissionGrants.id),
  action: text('action', { enum: ['approved', 'revoked'] }).notNull(),
  actor: text('actor').notNull(),
  at: text('at').notNull(),
});
