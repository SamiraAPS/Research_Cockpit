CREATE TABLE `work_discoveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_id` text NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`provider` text NOT NULL,
	`source_record_id` text NOT NULL,
	`search_layer` text NOT NULL,
	`query_version` text NOT NULL,
	`discovered_at` text NOT NULL,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_work_discoveries_hit_unique` ON `work_discoveries` (`ingestion_run_id`,`provider`,`source_record_id`,`search_layer`);--> statement-breakpoint
CREATE INDEX `idx_work_discoveries_work_layer` ON `work_discoveries` (`work_id`,`search_layer`);--> statement-breakpoint
CREATE INDEX `idx_work_discoveries_run` ON `work_discoveries` (`ingestion_run_id`);--> statement-breakpoint
DROP INDEX `idx_work_sources_doi_unique`;--> statement-breakpoint
CREATE INDEX `idx_work_sources_doi` ON `work_sources` (`doi_normalized`);--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `search_layer` text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `safety_limit` integer DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE `ingestion_runs` ADD `limit_reached` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA optimize;
