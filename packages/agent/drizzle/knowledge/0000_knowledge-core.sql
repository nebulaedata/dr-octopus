CREATE TABLE `knowledge_blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`generationId` text NOT NULL,
	`documentId` text NOT NULL,
	`documentVersionId` text NOT NULL,
	`chunkId` text NOT NULL,
	`locator` text NOT NULL,
	`expiresAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`scopeKind` text NOT NULL,
	`workspaceId` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`activeGenerationId` text,
	`rebuildJobId` text,
	`createdAt` text NOT NULL,
	`deletedAt` text,
	CONSTRAINT "knowledge_scope_valid" CHECK(("knowledge_collections"."scopeKind" = 'global' AND "knowledge_collections"."workspaceId" IS NULL) OR ("knowledge_collections"."scopeKind" = 'workspace' AND "knowledge_collections"."workspaceId" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `knowledge_scope_page` ON `knowledge_collections` (`scopeKind`,`workspaceId`,`createdAt`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`title` text NOT NULL,
	`format` text NOT NULL,
	`sourcePath` text DEFAULT '' NOT NULL,
	`activeVersionId` text,
	`desiredVersionId` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`createdAt` text NOT NULL,
	`deletedAt` text,
	FOREIGN KEY (`collectionId`) REFERENCES `knowledge_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `knowledge_document_page` ON `knowledge_documents` (`collectionId`,`createdAt`,`id`);--> statement-breakpoint
CREATE TABLE `knowledge_index_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`generationId` text NOT NULL,
	`documentId` text NOT NULL,
	`documentVersionId` text NOT NULL,
	`indexRevision` text NOT NULL,
	`chunkCount` integer NOT NULL,
	FOREIGN KEY (`generationId`) REFERENCES `knowledge_index_generations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`documentId`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`documentVersionId`) REFERENCES `knowledge_document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_generation_document` ON `knowledge_index_entries` (`generationId`,`documentId`);--> statement-breakpoint
CREATE TABLE `knowledge_index_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`embeddingConfig` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`collectionId`) REFERENCES `knowledge_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `knowledge_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`jobId` text NOT NULL,
	`entryKey` text NOT NULL,
	`archivePath` text NOT NULL,
	`documentId` text,
	`status` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`reason` text,
	FOREIGN KEY (`jobId`) REFERENCES `knowledge_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_import_leaf` ON `knowledge_import_items` (`jobId`,`entryKey`);--> statement-breakpoint
CREATE TABLE `knowledge_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`collectionId` text NOT NULL,
	`principal` text NOT NULL,
	`kind` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`payloadHash` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`automaticRetries` integer DEFAULT 0 NOT NULL,
	`cancelRequested` integer DEFAULT false NOT NULL,
	`blockedReason` text,
	`source` text,
	`ocrSnapshot` text,
	`embeddingSnapshot` text,
	`targetGenerationId` text,
	`error` text,
	`createdAt` text NOT NULL,
	`finishedAt` text,
	FOREIGN KEY (`collectionId`) REFERENCES `knowledge_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_job_request` ON `knowledge_jobs` (`principal`,`kind`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `knowledge_job_queue` ON `knowledge_jobs` (`state`,`createdAt`);--> statement-breakpoint
CREATE TABLE `knowledge_remote_mounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionRef` text NOT NULL,
	`instanceId` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`catalog` text NOT NULL,
	`lastSuccessAt` text,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_remote_mounts_instanceId_unique` ON `knowledge_remote_mounts` (`instanceId`);--> statement-breakpoint
CREATE TABLE `knowledge_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`models` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`sourceSha256` text NOT NULL,
	`parserVersion` text NOT NULL,
	`coverage` text DEFAULT 'complete' NOT NULL,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE no action
);
