PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'agent' NOT NULL,
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
	`pinned_at` text,
	`notification_version` integer DEFAULT 0 NOT NULL,
	`read_version` integer DEFAULT 0 NOT NULL,
	`execution_json` text,
	CONSTRAINT "sessions_kind_check" CHECK("__new_sessions"."kind" IN ('agent', 'knowledge'))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "kind", "workspace_id", "agent_session_id", "agent_session_path", "title", "provider", "model", "thinking_level", "steering_mode", "follow_up_mode", "auto_compaction_enabled", "auto_retry_enabled", "created_at", "updated_at", "last_active_at", "last_message_at", "pinned_at", "notification_version", "read_version", "execution_json") SELECT "id", "kind", "workspace_id", "agent_session_id", "agent_session_path", "title", "provider", "model", "thinking_level", "steering_mode", "follow_up_mode", "auto_compaction_enabled", "auto_retry_enabled", "created_at", "updated_at", "last_active_at", "last_message_at", "pinned_at", "notification_version", "read_version", "execution_json" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_agent_session_id_unique` ON `sessions` (`agent_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_agent_session_path_unique` ON `sessions` (`agent_session_path`);--> statement-breakpoint
CREATE INDEX `sessions_workspace_id_idx` ON `sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at`);