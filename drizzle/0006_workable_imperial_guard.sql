CREATE TABLE `user_shortlist_items` (
	`user_id` text NOT NULL,
	`work_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `work_id`),
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_shortlist_user_created` ON `user_shortlist_items` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_user_shortlist_work` ON `user_shortlist_items` (`work_id`);--> statement-breakpoint
CREATE INDEX `idx_work_versions_current_source` ON `work_versions` (`is_current`,`source_name`);--> statement-breakpoint
CREATE INDEX `idx_work_versions_current_citations` ON `work_versions` (`is_current`,`cited_by_count`);--> statement-breakpoint
CREATE INDEX `idx_works_first_seen` ON `works` (`first_seen_at`);--> statement-breakpoint
PRAGMA optimize;
