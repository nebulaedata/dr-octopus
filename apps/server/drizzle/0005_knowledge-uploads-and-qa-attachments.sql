CREATE TABLE `knowledge_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`request_key` text NOT NULL,
	`filename` text NOT NULL,
	`staging_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`offset` integer DEFAULT 0 NOT NULL,
	`blob_sha256` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "knowledge_upload_offset_check" CHECK("knowledge_uploads"."offset" >= 0 AND "knowledge_uploads"."offset" <= "knowledge_uploads"."byte_size")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_uploads_request_key_unique` ON `knowledge_uploads` (`request_key`);--> statement-breakpoint
ALTER TABLE `knowledge_qa_turns` ADD `attachment_refs` text DEFAULT '[]' NOT NULL;