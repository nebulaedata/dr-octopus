CREATE TABLE `knowledge_remote_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`mountId` text NOT NULL,
	`collectionId` text NOT NULL,
	`remoteReadRef` text NOT NULL,
	`expiresAt` text NOT NULL,
	FOREIGN KEY (`mountId`) REFERENCES `knowledge_remote_mounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_sharing` (
	`id` integer PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`tokenHash` text
);
