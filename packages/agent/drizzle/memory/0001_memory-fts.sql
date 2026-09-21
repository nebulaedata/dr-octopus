-- FTS5 virtual tables and triggers are not expressible through Drizzle sqliteTable.
CREATE VIRTUAL TABLE memory_fts USING fts5(indexText, topic, canonicalKey, tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory_indexes WHEN new.status = 'active' BEGIN
  INSERT INTO memory_fts(rowid,indexText,topic,canonicalKey) VALUES(new.id,new.indexText,new.topic,new.canonicalKey);
END;
--> statement-breakpoint
CREATE TRIGGER memory_fts_update AFTER UPDATE ON memory_indexes BEGIN
  DELETE FROM memory_fts WHERE rowid=old.id;
  INSERT INTO memory_fts(rowid,indexText,topic,canonicalKey) SELECT new.id,new.indexText,new.topic,new.canonicalKey WHERE new.status='active';
END;
--> statement-breakpoint
CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory_indexes BEGIN
  DELETE FROM memory_fts WHERE rowid=old.id;
END;
