ALTER TABLE `permission_grant_audit` ADD `schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `permission_grants` ADD `schema_version` integer DEFAULT 1 NOT NULL;