CREATE TABLE `permission_grant_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `permission_grants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `permission_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`execution_digest` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`tools` text NOT NULL,
	`operation_id` text NOT NULL,
	`approved_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_grants_operation_id_unique` ON `permission_grants` (`operation_id`);