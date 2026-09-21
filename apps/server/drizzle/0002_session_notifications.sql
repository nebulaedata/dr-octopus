CREATE TABLE `session_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_key` text NOT NULL,
	`workspace_id` text NOT NULL,
	`session_id` text NOT NULL,
	`origin_session_id` text,
	`task_id` text,
	`run_id` text,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_notifications_event_key_unique` ON `session_notifications` (`event_key`);--> statement-breakpoint
CREATE INDEX `session_notifications_session_idx` ON `session_notifications` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `session_notifications_run_idx` ON `session_notifications` (`workspace_id`,`run_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `notification_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `read_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `execution_json` text;