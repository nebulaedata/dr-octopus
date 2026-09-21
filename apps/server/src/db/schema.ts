/**
 * @author Codex
 * @description 定义 Server 控制面 SQLite schema，作为 Drizzle 查询和迁移生成的唯一结构来源。
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
// Historical experiment tables remain as an archive; ordinary Session mode owns all new QA state.
type QaConfig = { collectionIds: string[]; provider: string; model: string; revision: number };
type QaTurnState = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['agent', 'knowledge'] })
      .notNull()
      .default('agent'),
    workspaceId: text('workspace_id').notNull(),
    agentSessionId: text('agent_session_id').notNull().unique(),
    agentSessionPath: text('agent_session_path').notNull().unique(),
    title: text('title').notNull(),
    provider: text('provider'),
    model: text('model'),
    thinkingLevel: text('thinking_level'),
    steeringMode: text('steering_mode').notNull().default('one-at-a-time'),
    followUpMode: text('follow_up_mode').notNull().default('one-at-a-time'),
    autoCompactionEnabled: integer('auto_compaction_enabled', { mode: 'boolean' }).notNull().default(true),
    autoRetryEnabled: integer('auto_retry_enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastActiveAt: text('last_active_at'),
    lastMessageAt: text('last_message_at'),
    pinnedAt: text('pinned_at'),
    notificationVersion: integer('notification_version').notNull().default(0),
    readVersion: integer('read_version').notNull().default(0),
    execution: text('execution_json', { mode: 'json' }).$type<{
      taskId: string;
      runId: string;
      status: string;
    }>(),
  },
  (table) => [
    index('sessions_workspace_id_idx').on(table.workspaceId),
    check('sessions_kind_check', sql`${table.kind} IN ('agent', 'knowledge')`),
    index('sessions_updated_at_idx').on(table.updatedAt),
  ]
);

export const knowledgeQaSessions = sqliteTable('knowledge_qa_sessions', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  config: text('config_json', { mode: 'json' }).$type<QaConfig>().notNull(),
  creationHash: text('creation_hash'),
  persistenceState: text('persistence_state', { enum: ['pending', 'persisted'] })
    .notNull()
    .default('pending'),
  profileVersion: integer('profile_version').notNull().default(1),
});

export const knowledgeUploads = sqliteTable(
  'knowledge_uploads',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id'),
    requestKey: text('request_key').notNull().unique(),
    filename: text('filename').notNull(),
    stagingKey: text('staging_key').notNull(),
    byteSize: integer('byte_size').notNull(),
    offset: integer('offset').notNull().default(0),
    blobSha256: text('blob_sha256'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    check(
      'knowledge_upload_offset_check',
      sql`${table.offset} >= 0 AND ${table.offset} <= ${table.byteSize}`
    ),
  ]
);

export const knowledgeQaTurns = sqliteTable(
  'knowledge_qa_turns',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => knowledgeQaSessions.sessionId, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    retryOfRequestId: text('retry_of_request_id'),
    payloadHash: text('payload_hash').notNull(),
    inputText: text('input_text').notNull(),
    attachmentRefs: text('attachment_refs', { mode: 'json' }).$type<string[]>().notNull().default([]),
    configSnapshot: text('config_snapshot', { mode: 'json' }).$type<QaConfig>().notNull(),
    state: text('state').$type<QaTurnState>().notNull(),
    agentEntryId: text('agent_entry_id'),
    deterministicOutcome: text('deterministic_outcome'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.requestId] }),
    uniqueIndex('knowledge_qa_turn_order').on(table.sessionId, table.ordinal),
    uniqueIndex('knowledge_qa_single_retry').on(table.sessionId, table.retryOfRequestId),
  ]
);

export const knowledgeQaCitations = sqliteTable(
  'knowledge_qa_citations',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => knowledgeQaSessions.sessionId, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    label: text('label').notNull(),
    citationId: text('citation_id').notNull(),
    collectionRef: text('collection_ref').notNull(),
    generationId: text('generation_id').notNull(),
    documentId: text('document_id').notNull(),
    documentVersionId: text('document_version_id').notNull(),
    chunkId: text('chunk_id').notNull(),
    title: text('title').notNull(),
    locator: text('locator_json', { mode: 'json' }).$type<Record<string, string | number>>().notNull(),
    evidenceHash: text('evidence_hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.requestId, table.label] })]
);

export const messageFeedback = sqliteTable(
  'message_feedback',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    entryId: text('entry_id').notNull(),
    rating: text('rating').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('message_feedback_session_entry_idx').on(table.sessionId, table.entryId),
    index('message_feedback_session_id_idx').on(table.sessionId),
  ]
);

export const sessionNotifications = sqliteTable(
  'session_notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventKey: text('event_key').notNull().unique(),
    workspaceId: text('workspace_id').notNull(),
    sessionId: text('session_id').notNull(),
    originSessionId: text('origin_session_id'),
    taskId: text('task_id'),
    runId: text('run_id'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('session_notifications_session_idx').on(table.sessionId, table.id),
    index('session_notifications_run_idx').on(table.workspaceId, table.runId),
  ]
);

export const blobs = sqliteTable(
  'blobs',
  {
    sha256: text('sha256').primaryKey(),
    storageKey: text('storage_key').notNull().unique(),
    byteSize: integer('byte_size').notNull(),
    state: text('state', { enum: ['publishing', 'published', 'deleting'] }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('blobs_sha256_check', sql`length(${table.sha256}) = 64`),
    check('blobs_byte_size_check', sql`${table.byteSize} >= 0`),
    check('blobs_state_check', sql`${table.state} IN ('publishing', 'published', 'deleting')`),
  ]
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    ownerId: text('owner_id').notNull(),
    originalName: text('original_name').notNull(),
    declaredMime: text('declared_mime'),
    detectedMime: text('detected_mime'),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256'),
    blobSha256: text('blob_sha256').references(() => blobs.sha256, { onDelete: 'restrict' }),
    status: text('status', {
      enum: ['initiated', 'uploading', 'verifying', 'processing', 'ready', 'failed', 'rejected', 'deleted'],
    }).notNull(),
    classification: text('classification', {
      enum: ['direct-image', 'extractable-document', 'manifest-only-binary', 'rejected'],
    }),
    presentationKind: text('presentation_kind', { enum: ['image', 'audio', 'video', 'file'] }),
    failureCode: text('failure_code'),
    failureRetryable: integer('failure_retryable', { mode: 'boolean' }).notNull().default(false),
    policyVersion: text('policy_version'),
    ruleVersion: text('rule_version'),
    revision: integer('revision').notNull().default(1),
    evidenceJson: text('evidence_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    readyAt: text('ready_at'),
    expiresAt: text('expires_at'),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    check('attachments_byte_size_check', sql`${table.byteSize} >= 0`),
    check('attachments_revision_check', sql`${table.revision} >= 1`),
    check('attachments_failure_retryable_check', sql`${table.failureRetryable} IN (0, 1)`),
    check(
      'attachments_status_check',
      sql`${table.status} IN ('initiated', 'uploading', 'verifying', 'processing', 'ready', 'failed', 'rejected', 'deleted')`
    ),
    check(
      'attachments_classification_check',
      sql`${table.classification} IS NULL OR ${table.classification} IN ('direct-image', 'extractable-document', 'manifest-only-binary', 'rejected')`
    ),
    check(
      'attachments_presentation_kind_check',
      sql`${table.presentationKind} IS NULL OR ${table.presentationKind} IN ('image', 'audio', 'video', 'file')`
    ),
    index('attachments_workspace_status_updated_idx').on(table.workspaceId, table.status, table.updatedAt),
    index('attachments_workspace_expires_idx').on(table.workspaceId, table.expiresAt),
  ]
);

export const tusUploads = sqliteTable(
  'tus_uploads',
  {
    uploadId: text('upload_id')
      .primaryKey()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    uploadLength: integer('upload_length').notNull(),
    uploadOffset: integer('upload_offset').notNull(),
    metadataJson: text('metadata_json').notNull(),
    stagingKey: text('staging_key').notNull().unique(),
    expiresAt: text('expires_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check('tus_upload_length_check', sql`${table.uploadLength} >= 0`),
    check(
      'tus_upload_offset_check',
      sql`${table.uploadOffset} >= 0 AND ${table.uploadOffset} <= ${table.uploadLength}`
    ),
    index('tus_uploads_expires_idx').on(table.expiresAt),
  ]
);

export const attachmentDerivatives = sqliteTable(
  'attachment_derivatives',
  {
    id: text('id').primaryKey(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    processorId: text('processor_id').notNull(),
    processorVersion: text('processor_version').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width'),
    height: integer('height'),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    metadataJson: text('metadata_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('attachment_derivatives_byte_size_check', sql`${table.byteSize} >= 0`),
    uniqueIndex('attachment_derivatives_identity_idx').on(
      table.attachmentId,
      table.kind,
      table.processorId,
      table.processorVersion,
      table.sourceSha256
    ),
  ]
);

export const messageAttachments = sqliteTable(
  'message_attachments',
  {
    sessionId: text('session_id').notNull(),
    entryId: text('entry_id').notNull(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    requestId: text('request_id').notNull(),
    presentationJson: text('presentation_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.entryId, table.attachmentId] }),
    uniqueIndex('message_attachments_entry_ordinal_idx').on(table.sessionId, table.entryId, table.ordinal),
    index('message_attachments_attachment_idx').on(table.attachmentId),
    check('message_attachments_ordinal_check', sql`${table.ordinal} >= 0`),
  ]
);

export const attachmentOperations = sqliteTable('attachment_operations', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  fingerprint: text('fingerprint').notNull(),
  attachmentId: text('attachment_id'),
  operation: text('operation').notNull(),
  phase: text('phase').notNull(),
  stagingKey: text('staging_key'),
  targetStorageKey: text('target_storage_key'),
  expectedSize: integer('expected_size'),
  expectedSha256: text('expected_sha256'),
  resultJson: text('result_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  expiresAt: text('expires_at'),
});

export const attachmentJobs = sqliteTable(
  'attachment_jobs',
  {
    id: text('id').primaryKey(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    jobType: text('job_type').notNull(),
    processorId: text('processor_id'),
    processorVersion: text('processor_version'),
    inputJson: text('input_json').notNull(),
    status: text('status', { enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'] }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    availableAt: text('available_at').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: text('lease_expires_at'),
    lastErrorCode: text('last_error_code'),
    resultJson: text('result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    check(
      'attachment_jobs_status_check',
      sql`${table.status} IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')`
    ),
    index('attachment_jobs_claim_idx').on(table.status, table.availableAt, table.leaseExpiresAt),
  ]
);

export const attachmentChunks = sqliteTable(
  'attachment_chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    derivativeId: text('derivative_id')
      .notNull()
      .references(() => attachmentDerivatives.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    sourceLocatorJson: text('source_locator_json').notNull(),
    text: text('text').notNull(),
    characterCount: integer('character_count').notNull(),
    tokenEstimate: integer('token_estimate').notNull(),
  },
  (table) => [
    uniqueIndex('attachment_chunks_derivative_ordinal_idx').on(table.derivativeId, table.ordinal),
    index('attachment_chunks_attachment_idx').on(table.attachmentId, table.derivativeId, table.ordinal),
  ]
);

export const backupRuns = sqliteTable(
  'backup_runs',
  {
    id: text('id').primaryKey(),
    status: text('status', { enum: ['preparing', 'copying', 'verified', 'failed'] }).notNull(),
    databaseSnapshotKey: text('database_snapshot_key'),
    manifestKey: text('manifest_key'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    check('backup_runs_status_check', sql`${table.status} IN ('preparing', 'copying', 'verified', 'failed')`),
  ]
);

export const backupBlobPins = sqliteTable(
  'backup_blob_pins',
  {
    backupId: text('backup_id')
      .notNull()
      .references(() => backupRuns.id, { onDelete: 'cascade' }),
    blobSha256: text('blob_sha256')
      .notNull()
      .references(() => blobs.sha256, { onDelete: 'restrict' }),
  },
  (table) => [primaryKey({ columns: [table.backupId, table.blobSha256] })]
);

export const attachmentLegalHolds = sqliteTable('attachment_legal_holds', {
  attachmentId: text('attachment_id')
    .primaryKey()
    .references(() => attachments.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull(),
});

export const attachmentAuditEvents = sqliteTable(
  'attachment_audit_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    provider: text('provider'),
    modelId: text('model_id'),
    sessionId: text('session_id'),
    requestId: text('request_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('attachment_audit_attachment_created_idx').on(table.attachmentId, table.createdAt)]
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type MessageFeedbackRow = typeof messageFeedback.$inferSelect;
export type NewMessageFeedbackRow = typeof messageFeedback.$inferInsert;
export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
