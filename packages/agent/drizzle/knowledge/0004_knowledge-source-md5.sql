ALTER TABLE `knowledge_blobs` ADD `md5` text;--> statement-breakpoint
CREATE INDEX `knowledge_blob_md5` ON `knowledge_blobs` (`md5`);