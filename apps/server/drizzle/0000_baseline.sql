CREATE TABLE `attachment_audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attachment_id` text NOT NULL,
	`event_type` text NOT NULL,
	`provider` text,
	`model_id` text,
	`session_id` text,
	`request_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `attachment_audit_attachment_created_idx` ON `attachment_audit_events` (`attachment_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `attachment_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attachment_id` text NOT NULL,
	`derivative_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source_locator_json` text NOT NULL,
	`text` text NOT NULL,
	`character_count` integer NOT NULL,
	`token_estimate` integer NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`derivative_id`) REFERENCES `attachment_derivatives`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_chunks_derivative_ordinal_idx` ON `attachment_chunks` (`derivative_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `attachment_chunks_attachment_idx` ON `attachment_chunks` (`attachment_id`,`derivative_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `attachment_derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_id` text NOT NULL,
	`kind` text NOT NULL,
	`processor_id` text NOT NULL,
	`processor_version` text NOT NULL,
	`source_sha256` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`width` integer,
	`height` integer,
	`page_from` integer,
	`page_to` integer,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attachment_derivatives_byte_size_check" CHECK("attachment_derivatives"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_derivatives_identity_idx` ON `attachment_derivatives` (`attachment_id`,`kind`,`processor_id`,`processor_version`,`source_sha256`);--> statement-breakpoint
CREATE TABLE `attachment_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`attachment_id` text NOT NULL,
	`job_type` text NOT NULL,
	`processor_id` text,
	`processor_version` text,
	`input_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`last_error_code` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attachment_jobs_status_check" CHECK("attachment_jobs"."status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `attachment_jobs_claim_idx` ON `attachment_jobs` (`status`,`available_at`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `attachment_legal_holds` (
	`attachment_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `attachment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`attachment_id` text,
	`operation` text NOT NULL,
	`phase` text NOT NULL,
	`staging_key` text,
	`target_storage_key` text,
	`expected_size` integer,
	`expected_sha256` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_operations_idempotency_key_unique` ON `attachment_operations` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`original_name` text NOT NULL,
	`declared_mime` text,
	`detected_mime` text,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`blob_sha256` text,
	`status` text NOT NULL,
	`classification` text,
	`presentation_kind` text,
	`failure_code` text,
	`failure_retryable` integer DEFAULT false NOT NULL,
	`policy_version` text,
	`rule_version` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`evidence_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ready_at` text,
	`expires_at` text,
	`deleted_at` text,
	FOREIGN KEY (`blob_sha256`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attachments_byte_size_check" CHECK("attachments"."byte_size" >= 0),
	CONSTRAINT "attachments_revision_check" CHECK("attachments"."revision" >= 1),
	CONSTRAINT "attachments_failure_retryable_check" CHECK("attachments"."failure_retryable" IN (0, 1)),
	CONSTRAINT "attachments_status_check" CHECK("attachments"."status" IN ('initiated', 'uploading', 'verifying', 'processing', 'ready', 'failed', 'rejected', 'deleted')),
	CONSTRAINT "attachments_classification_check" CHECK("attachments"."classification" IS NULL OR "attachments"."classification" IN ('direct-image', 'extractable-document', 'manifest-only-binary', 'rejected')),
	CONSTRAINT "attachments_presentation_kind_check" CHECK("attachments"."presentation_kind" IS NULL OR "attachments"."presentation_kind" IN ('image', 'audio', 'video', 'file'))
);
--> statement-breakpoint
CREATE INDEX `attachments_workspace_status_updated_idx` ON `attachments` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `attachments_workspace_expires_idx` ON `attachments` (`workspace_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `backup_blob_pins` (
	`backup_id` text NOT NULL,
	`blob_sha256` text NOT NULL,
	PRIMARY KEY(`backup_id`, `blob_sha256`),
	FOREIGN KEY (`backup_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blob_sha256`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`database_snapshot_key` text,
	`manifest_key` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	CONSTRAINT "backup_runs_status_check" CHECK("backup_runs"."status" IN ('preparing', 'copying', 'verified', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`storage_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "blobs_sha256_check" CHECK(length("blobs"."sha256") = 64),
	CONSTRAINT "blobs_byte_size_check" CHECK("blobs"."byte_size" >= 0),
	CONSTRAINT "blobs_state_check" CHECK("blobs"."state" IN ('publishing', 'published', 'deleting'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_storage_key_unique` ON `blobs` (`storage_key`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`session_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`request_id` text NOT NULL,
	`presentation_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `entry_id`, `attachment_id`),
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "message_attachments_ordinal_check" CHECK("message_attachments"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_attachments_entry_ordinal_idx` ON `message_attachments` (`session_id`,`entry_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `message_attachments_attachment_idx` ON `message_attachments` (`attachment_id`);--> statement-breakpoint
CREATE TABLE `message_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`rating` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_feedback_session_entry_idx` ON `message_feedback` (`session_id`,`entry_id`);--> statement-breakpoint
CREATE INDEX `message_feedback_session_id_idx` ON `message_feedback` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_session_id` text NOT NULL,
	`agent_session_path` text NOT NULL,
	`title` text NOT NULL,
	`provider` text,
	`model` text,
	`thinking_level` text,
	`steering_mode` text DEFAULT 'one-at-a-time' NOT NULL,
	`follow_up_mode` text DEFAULT 'one-at-a-time' NOT NULL,
	`auto_compaction_enabled` integer DEFAULT true NOT NULL,
	`auto_retry_enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_active_at` text,
	`last_message_at` text,
	`pinned_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_agent_session_id_unique` ON `sessions` (`agent_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_agent_session_path_unique` ON `sessions` (`agent_session_path`);--> statement-breakpoint
CREATE INDEX `sessions_workspace_id_idx` ON `sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE TABLE `tus_uploads` (
	`upload_id` text PRIMARY KEY NOT NULL,
	`upload_length` integer NOT NULL,
	`upload_offset` integer NOT NULL,
	`metadata_json` text NOT NULL,
	`staging_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tus_upload_length_check" CHECK("tus_uploads"."upload_length" >= 0),
	CONSTRAINT "tus_upload_offset_check" CHECK("tus_uploads"."upload_offset" >= 0 AND "tus_uploads"."upload_offset" <= "tus_uploads"."upload_length")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tus_uploads_staging_key_unique` ON `tus_uploads` (`staging_key`);--> statement-breakpoint
CREATE INDEX `tus_uploads_expires_idx` ON `tus_uploads` (`expires_at`);