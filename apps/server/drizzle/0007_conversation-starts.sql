CREATE TABLE `conversation_starts` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`active_draft_id` text,
	`session_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`request_json` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_starts_active_draft_id_unique` ON `conversation_starts` (`active_draft_id`);