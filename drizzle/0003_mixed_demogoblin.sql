CREATE TABLE `call_ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`status` text NOT NULL,
	`registry_version` text NOT NULL,
	`source_version` text NOT NULL,
	`parser_version` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`found_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`content_hash` text,
	`requires_manual_review` integer DEFAULT false NOT NULL,
	`error_message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_call_ingestion_runs_source_started` ON `call_ingestion_runs` (`source_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_call_ingestion_runs_status_started` ON `call_ingestion_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `call_source_state` (
	`source_id` integer PRIMARY KEY NOT NULL,
	`registry_version` text NOT NULL,
	`source_version` text NOT NULL,
	`parser_version` text NOT NULL,
	`status` text NOT NULL,
	`approved_content_hash` text,
	`last_content_hash` text,
	`last_checked_at` text NOT NULL,
	`verified_at` text,
	`error_message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_call_source_state_status_checked` ON `call_source_state` (`status`,`last_checked_at`);--> statement-breakpoint
CREATE TABLE `call_themes` (
	`call_id` text NOT NULL,
	`theme` text NOT NULL,
	`analysis_version` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`call_id`, `theme`),
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_call_themes_theme` ON `call_themes` (`theme`);--> statement-breakpoint
CREATE TABLE `call_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`call_type` text NOT NULL,
	`organizer` text NOT NULL,
	`description` text NOT NULL,
	`official_url` text NOT NULL,
	`submission_deadline` text,
	`event_or_publication_date` text,
	`topics_json` text NOT NULL,
	`status` text NOT NULL,
	`parser_version` text NOT NULL,
	`source_version` text NOT NULL,
	`captured_at` text NOT NULL,
	`verified_at` text,
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `call_ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_call_versions_content_unique` ON `call_versions` (`call_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_call_versions_run` ON `call_versions` (`ingestion_run_id`);--> statement-breakpoint
CREATE INDEX `idx_call_versions_call_captured` ON `call_versions` (`call_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`source_record_id` text NOT NULL,
	`title` text NOT NULL,
	`call_type` text NOT NULL,
	`organizer` text NOT NULL,
	`description` text NOT NULL,
	`official_url` text NOT NULL,
	`submission_deadline` text,
	`event_or_publication_date` text,
	`status` text NOT NULL,
	`parser_version` text NOT NULL,
	`source_version` text NOT NULL,
	`first_captured_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`verified_at` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_calls_source_record_unique` ON `calls` (`source_id`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `idx_calls_status_deadline` ON `calls` (`status`,`submission_deadline`);--> statement-breakpoint
CREATE INDEX `idx_calls_source_seen` ON `calls` (`source_id`,`last_seen_at`);--> statement-breakpoint
PRAGMA optimize;
