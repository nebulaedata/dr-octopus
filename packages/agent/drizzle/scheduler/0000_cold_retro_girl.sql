CREATE TABLE `scheduler_mutations` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
--> statement-breakpoint
CREATE TABLE `scheduler_result_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`origin_session_ref` text NOT NULL,
	`kind` text DEFAULT 'run-completed' NOT NULL,
	`payload_version` integer DEFAULT 1 NOT NULL,
	`summary` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`available_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error_code` text,
	`delivered_at` text,
	`origin_entry_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `scheduler_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduler_delivery_identity` ON `scheduler_result_deliveries` (`run_id`,`origin_session_ref`,`kind`);--> statement-breakpoint
CREATE INDEX `scheduler_delivery_pending` ON `scheduler_result_deliveries` (`origin_session_ref`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `scheduler_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`status` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`available_at` text NOT NULL,
	`trigger_source` text NOT NULL,
	`workspace_id` text NOT NULL,
	`cwd` text NOT NULL,
	`origin_session_ref` text,
	`prompt` text NOT NULL,
	`config_revision` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`daemon_id` text,
	`attempt_id` text,
	`session_id` text,
	`session_path` text,
	`dispatch_at` text,
	`prompt_entry_id` text,
	`cancel_requested_at` text,
	`started_at` text,
	`settled_at` text,
	`summary` text,
	`error_code` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `scheduler_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduler_runs_occurrence` ON `scheduler_runs` (`task_id`,`occurrence_key`);--> statement-breakpoint
CREATE INDEX `scheduler_runs_claim` ON `scheduler_runs` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `scheduler_runs_history` ON `scheduler_runs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduler_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`cwd` text NOT NULL,
	`origin_session_ref` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`prompt` text NOT NULL,
	`schedule_json` text NOT NULL,
	`enabled` integer NOT NULL,
	`revision` integer NOT NULL,
	`config_revision` text NOT NULL,
	`next_run_at` text,
	`paused_at` text,
	`misfire_policy` text NOT NULL,
	`overlap_policy` text NOT NULL,
	`timeout_ms` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "scheduler_tasks_revision_positive" CHECK("scheduler_tasks"."revision" > 0),
	CONSTRAINT "scheduler_tasks_timeout_positive" CHECK("scheduler_tasks"."timeout_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX `scheduler_tasks_due` ON `scheduler_tasks` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `scheduler_tasks_workspace` ON `scheduler_tasks` (`workspace_id`,`updated_at`);