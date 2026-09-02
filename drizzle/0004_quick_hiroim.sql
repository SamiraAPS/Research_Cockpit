ALTER TABLE `work_themes` ADD `classification_version` text DEFAULT 'weighted-lexical-2.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_themes` ADD `ontology_version` text DEFAULT 'human-work-themes-2.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_themes` ADD `score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `work_themes` ADD `evidence_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `work_themes`
SET `classification_version` = 'legacy-unscored', `ontology_version` = 'legacy-unversioned'
WHERE `analysis_version` <> 'rule-based-2.0.0';--> statement-breakpoint
PRAGMA optimize;
