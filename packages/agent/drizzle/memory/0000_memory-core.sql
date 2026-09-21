CREATE TABLE `memory_forget_barriers` (
	`hash` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_indexes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonicalKey` text NOT NULL,
	`topic` text NOT NULL,
	`type` text NOT NULL,
	`indexText` text NOT NULL,
	`sectionId` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`supersededBy` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`activationSeq` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sectionId`) REFERENCES `memory_wiki_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_indexes_sectionId_unique` ON `memory_indexes` (`sectionId`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_indexes_activationSeq_unique` ON `memory_indexes` (`activationSeq`);--> statement-breakpoint
CREATE INDEX `memory_active_sequence` ON `memory_indexes` (`status`,`activationSeq`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_active_canonical` ON `memory_indexes` (`canonicalKey`) WHERE "memory_indexes"."status" = 'active';--> statement-breakpoint
CREATE TABLE `memory_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`storeId` text NOT NULL,
	`mode` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`activationCounter` integer DEFAULT 0 NOT NULL,
	`writeEpoch` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "memory_singleton" CHECK("memory_meta"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `memory_mutations` (
	`requestId` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`receipt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_sources` (
	`indexId` integer PRIMARY KEY NOT NULL,
	`values` text NOT NULL,
	FOREIGN KEY (`indexId`) REFERENCES `memory_indexes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_wiki_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_wiki_pages_slug_unique` ON `memory_wiki_pages` (`slug`);--> statement-breakpoint
CREATE TABLE `memory_wiki_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pageId` integer NOT NULL,
	`bodyMd` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pageId`) REFERENCES `memory_wiki_pages`(`id`) ON UPDATE no action ON DELETE no action
);
