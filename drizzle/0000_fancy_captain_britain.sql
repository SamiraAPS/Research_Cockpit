CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`query_version` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`found_count` integer DEFAULT 0 NOT NULL,
	`loaded_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_runs_source_scope_started` ON `ingestion_runs` (`source_id`,`scope`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_ingestion_runs_status_started` ON `ingestion_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `source_health` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`check_name` text NOT NULL,
	`status` text NOT NULL,
	`latency_ms` integer,
	`http_status` integer,
	`error_message` text,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_source_health_source_checked` ON `source_health` (`source_id`,`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_source_health_run` ON `source_health` (`ingestion_run_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text,
	`area` text,
	`homepage_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sources_key_unique` ON `sources` (`key`);--> statement-breakpoint
CREATE INDEX `idx_sources_kind` ON `sources` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_sources_external_id` ON `sources` (`external_id`);--> statement-breakpoint
CREATE TABLE `trend_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`publication_type` text NOT NULL,
	`year` integer NOT NULL,
	`record_count` integer NOT NULL,
	`captured_at` text NOT NULL,
	`query_version` text NOT NULL,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trend_snapshots_run_series_unique` ON `trend_snapshots` (`ingestion_run_id`,`scope`,`publication_type`,`year`);--> statement-breakpoint
CREATE INDEX `idx_trend_snapshots_source_captured` ON `trend_snapshots` (`source_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_trend_snapshots_year_type` ON `trend_snapshots` (`year`,`publication_type`);--> statement-breakpoint
CREATE TABLE `work_scopes` (
	`work_id` text NOT NULL,
	`scope` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`work_id`, `scope`),
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_work_scopes_scope_last_seen` ON `work_scopes` (`scope`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `work_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`doi_normalized` text,
	`openalex_id` text,
	`source_record_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_sources_openalex_unique` ON `work_sources` (`openalex_id`) WHERE "work_sources"."openalex_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_sources_doi_unique` ON `work_sources` (`doi_normalized`) WHERE "work_sources"."doi_normalized" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_sources_record_unique` ON `work_sources` (`source_id`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `idx_work_sources_work` ON `work_sources` (`work_id`);--> statement-breakpoint
CREATE TABLE `work_themes` (
	`work_id` text NOT NULL,
	`theme` text NOT NULL,
	`analysis_version` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`work_id`, `theme`),
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_work_themes_theme` ON `work_themes` (`theme`);--> statement-breakpoint
CREATE TABLE `work_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`version_type` text NOT NULL,
	`title` text NOT NULL,
	`abstract` text,
	`authors_json` text NOT NULL,
	`doi` text,
	`doi_normalized` text,
	`openalex_id` text,
	`source_record_id` text,
	`source_name` text NOT NULL,
	`publication_date` text,
	`online_date` text,
	`url` text NOT NULL,
	`is_open_access` integer NOT NULL,
	`cited_by_count` integer DEFAULT 0 NOT NULL,
	`topics_json` text NOT NULL,
	`keywords_json` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`created_at` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_versions_content_unique` ON `work_versions` (`work_id`,`version_type`,`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_versions_current_type_unique` ON `work_versions` (`work_id`,`version_type`) WHERE "work_versions"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `idx_work_versions_current_date` ON `work_versions` (`is_current`,`publication_date`);--> statement-breakpoint
CREATE INDEX `idx_work_versions_run` ON `work_versions` (`ingestion_run_id`);--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_doi` text,
	`doi_normalized` text,
	`primary_openalex_id` text,
	`normalized_title` text NOT NULL,
	`created_at` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_works_doi_unique` ON `works` (`doi_normalized`) WHERE "works"."doi_normalized" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_works_openalex_unique` ON `works` (`primary_openalex_id`) WHERE "works"."primary_openalex_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_works_normalized_title` ON `works` (`normalized_title`);--> statement-breakpoint
CREATE INDEX `idx_works_last_seen` ON `works` (`last_seen_at`);
--> statement-breakpoint
PRAGMA optimize;
