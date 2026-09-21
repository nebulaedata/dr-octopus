/**
 * @author Codex
 * @description Agent-owned scheduler relational schema, independent of the Server catalog and migrations.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { TaskAuthorizationRef, Schedule } from '@octopus/shared/protocol/scheduled-tasks';

export const tasks = sqliteTable(
  'scheduler_tasks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    cwd: text('cwd').notNull(),
    originSessionRef: text('origin_session_ref'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    prompt: text('prompt').notNull(),
    schedule: text('schedule_json', { mode: 'json' }).$type<Schedule>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    revision: integer('revision').notNull(),
    configRevision: text('config_revision').notNull(),
    authorizationRef: text('authorization_ref', { mode: 'json' }).$type<TaskAuthorizationRef>(),
    authorizationBlock: text('authorization_block').default('SCHEDULE_AUTHORIZATION_REQUIRED'),
    nextRunAt: text('next_run_at'),
    pausedAt: text('paused_at'),
    misfirePolicy: text('misfire_policy', { enum: ['skip', 'coalesce'] }).notNull(),
    overlapPolicy: text('overlap_policy', { enum: ['skip', 'queue-one'] }).notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('scheduler_tasks_due').on(table.enabled, table.nextRunAt),
    index('scheduler_tasks_workspace').on(table.workspaceId, table.updatedAt),
    check('scheduler_tasks_revision_positive', sql`${table.revision} > 0`),
    check('scheduler_tasks_timeout_positive', sql`${table.timeoutMs} > 0`),
  ]
);

export const runs = sqliteTable(
  'scheduler_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    occurrenceKey: text('occurrence_key').notNull(),
    status: text('status', {
      enum: [
        'queued',
        'claimed',
        'dispatching',
        'running',
        'succeeded',
        'failed',
        'needs_attention',
        'timed_out',
        'cancelled',
        'interrupted',
        'skipped',
      ],
    }).notNull(),
    scheduledFor: text('scheduled_for').notNull(),
    availableAt: text('available_at').notNull(),
    triggerSource: text('trigger_source', { enum: ['schedule', 'manual'] }).notNull(),
    workspaceId: text('workspace_id').notNull(),
    cwd: text('cwd').notNull(),
    originSessionRef: text('origin_session_ref'),
    prompt: text('prompt').notNull(),
    configRevision: text('config_revision').notNull(),
    authorizationRef: text('authorization_ref', { mode: 'json' }).$type<TaskAuthorizationRef>(),
    timeoutMs: integer('timeout_ms').notNull(),
    daemonId: text('daemon_id'),
    attemptId: text('attempt_id'),
    sessionId: text('session_id'),
    sessionPath: text('session_path'),
    dispatchAt: text('dispatch_at'),
    promptEntryId: text('prompt_entry_id'),
    cancelRequestedAt: text('cancel_requested_at'),
    startedAt: text('started_at'),
    settledAt: text('settled_at'),
    summary: text('summary'),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('scheduler_runs_occurrence').on(table.taskId, table.occurrenceKey),
    index('scheduler_runs_claim').on(table.status, table.availableAt),
    index('scheduler_runs_history').on(table.taskId, table.createdAt),
  ]
);

export const mutations = sqliteTable(
  'scheduler_mutations',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    responseJson: text('response_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })]
);

export const resultDeliveries = sqliteTable(
  'scheduler_result_deliveries',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    originSessionRef: text('origin_session_ref').notNull(),
    kind: text('kind').notNull().default('run-completed'),
    payloadVersion: integer('payload_version').notNull().default(1),
    summary: text('summary').notNull(),
    status: text('status', { enum: ['pending', 'delivered', 'undeliverable'] })
      .notNull()
      .default('pending'),
    availableAt: text('available_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    deliveredAt: text('delivered_at'),
    originEntryId: text('origin_entry_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('scheduler_delivery_identity').on(table.runId, table.originSessionRef, table.kind),
    index('scheduler_delivery_pending').on(table.originSessionRef, table.status, table.availableAt),
  ]
);
