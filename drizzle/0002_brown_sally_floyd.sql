PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`unpaid_break_minutes` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`overtime_flag` integer NOT NULL,
	`notes` text,
	`pattern_id` text,
	`user_modified` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`) REFERENCES `rota_patterns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_shifts`("id", "job_id", "date", "start", "end", "unpaid_break_minutes", "source", "status", "overtime_flag", "notes", "pattern_id", "user_modified") SELECT "id", "job_id", "date", "start", "end", "unpaid_break_minutes", "source", "status", "overtime_flag", "notes", CASE WHEN "pattern_id" IN (SELECT "id" FROM `rota_patterns`) THEN "pattern_id" END, "user_modified" FROM `shifts`;--> statement-breakpoint
DROP TABLE `shifts`;--> statement-breakpoint
ALTER TABLE `__new_shifts` RENAME TO `shifts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shifts_job_id_date_idx` ON `shifts` (`job_id`,`date`);--> statement-breakpoint
CREATE INDEX `shifts_date_idx` ON `shifts` (`date`);--> statement-breakpoint
CREATE INDEX `shifts_pattern_id_idx` ON `shifts` (`pattern_id`);