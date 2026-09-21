CREATE TABLE `knowledge_qa_citations` (
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`label` text NOT NULL,
	`citation_id` text NOT NULL,
	`collection_ref` text NOT NULL,
	`generation_id` text NOT NULL,
	`document_id` text NOT NULL,
	`document_version_id` text NOT NULL,
	`chunk_id` text NOT NULL,
	`title` text NOT NULL,
	`locator_json` text NOT NULL,
	`evidence_hash` text NOT NULL,
	PRIMARY KEY(`session_id`, `request_id`, `label`),
	FOREIGN KEY (`session_id`) REFERENCES `knowledge_qa_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_qa_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`persistence_state` text DEFAULT 'pending' NOT NULL,
	`profile_version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `knowledge_qa_turns` (
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`retry_of_request_id` text,
	`payload_hash` text NOT NULL,
	`input_text` text NOT NULL,
	`config_snapshot` text NOT NULL,
	`state` text NOT NULL,
	`agent_entry_id` text,
	`deterministic_outcome` text,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	PRIMARY KEY(`session_id`, `request_id`),
	FOREIGN KEY (`session_id`) REFERENCES `knowledge_qa_sessions`(`session_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_qa_turn_order` ON `knowledge_qa_turns` (`session_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_qa_single_retry` ON `knowledge_qa_turns` (`session_id`,`retry_of_request_id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `kind` text DEFAULT 'agent' NOT NULL;