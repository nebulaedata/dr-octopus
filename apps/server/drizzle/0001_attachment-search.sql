-- Drizzle's SQLite schema API does not represent FTS5 virtual tables or their synchronization triggers.
CREATE VIRTUAL TABLE `attachment_chunks_fts` USING fts5(
	`text`,
	content='attachment_chunks',
	content_rowid='id'
);
--> statement-breakpoint
CREATE TRIGGER `attachment_chunks_ai` AFTER INSERT ON `attachment_chunks` BEGIN
	INSERT INTO `attachment_chunks_fts` (rowid, `text`) VALUES (new.id, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `attachment_chunks_ad` AFTER DELETE ON `attachment_chunks` BEGIN
	INSERT INTO `attachment_chunks_fts` (`attachment_chunks_fts`, rowid, `text`)
	VALUES ('delete', old.id, old.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `attachment_chunks_au` AFTER UPDATE ON `attachment_chunks` BEGIN
	INSERT INTO `attachment_chunks_fts` (`attachment_chunks_fts`, rowid, `text`)
	VALUES ('delete', old.id, old.`text`);
	INSERT INTO `attachment_chunks_fts` (rowid, `text`) VALUES (new.id, new.`text`);
END;
