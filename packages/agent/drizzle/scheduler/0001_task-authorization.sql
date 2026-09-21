ALTER TABLE `scheduler_runs` ADD `authorization_ref` text;--> statement-breakpoint
ALTER TABLE `scheduler_tasks` ADD `authorization_ref` text;--> statement-breakpoint
ALTER TABLE `scheduler_tasks` ADD `authorization_block` text DEFAULT 'SCHEDULE_AUTHORIZATION_REQUIRED';