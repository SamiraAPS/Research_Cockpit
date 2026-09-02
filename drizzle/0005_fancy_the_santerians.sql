CREATE TABLE `theme_signal_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`ingestion_run_id` text NOT NULL,
	`scope` text NOT NULL,
	`theme` text NOT NULL,
	`snapshot_version` text NOT NULL,
	`analysis_version` text NOT NULL,
	`captured_at` text NOT NULL,
	`stable_end_year` integer NOT NULL,
	`quality_status` text NOT NULL,
	`absolute_count` integer NOT NULL,
	`per_thousand` real,
	`journal_count` integer NOT NULL,
	`preprint_count` integer NOT NULL,
	`short_growth_percent` real,
	`long_growth_percent` real,
	`acceleration_percentage_points` real,
	`source_count` integer NOT NULL,
	`venue_count` integer NOT NULL,
	`active_call_count` integer NOT NULL,
	`opportunity_score` integer,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`ingestion_run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_theme_signal_snapshots_run_scope_theme` ON `theme_signal_snapshots` (`ingestion_run_id`,`scope`,`theme`);--> statement-breakpoint
CREATE INDEX `idx_theme_signal_snapshots_scope_captured` ON `theme_signal_snapshots` (`scope`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_theme_signal_snapshots_theme_year` ON `theme_signal_snapshots` (`theme`,`stable_end_year`);--> statement-breakpoint
PRAGMA optimize;
