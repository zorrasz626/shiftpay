CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_rate_pence` integer NOT NULL,
	`pay_frequency` text NOT NULL,
	`pay_period_anchor_date` text NOT NULL,
	`pay_day_offset_days` integer NOT NULL,
	`period_cutoff_day` integer NOT NULL,
	`contracted_hours_per_week` real NOT NULL,
	`bank_holiday_region` text NOT NULL,
	`overtime_premium_mode` text DEFAULT 'highest' NOT NULL,
	`holiday_year_start` text NOT NULL,
	`holiday_entitlement_hours` real NOT NULL,
	`holiday_mode` text DEFAULT 'fixed' NOT NULL,
	`colour` text
);
--> statement-breakpoint
CREATE TABLE `payslip_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`payslip_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`hours` real,
	`amount_pence` integer NOT NULL,
	FOREIGN KEY (`payslip_id`) REFERENCES `payslips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslip_lines_payslip_id_idx` ON `payslip_lines` (`payslip_id`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`gross_paid_pence` integer NOT NULL,
	`hours_paid` real,
	`tax_pence` integer NOT NULL,
	`ni_pence` integer NOT NULL,
	`pension_pence` integer NOT NULL,
	`net_pence` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payslips_job_id_idx` ON `payslips` (`job_id`);--> statement-breakpoint
CREATE TABLE `premium_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`multiplier` real,
	`flat_add_pence_per_hour` real,
	`start_time` text,
	`end_time` text,
	`days_of_week` text,
	`threshold_hours` real,
	`week_starts_on` integer,
	`stacking` text DEFAULT 'highest_only' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "premium_rules_rate_check" CHECK(("premium_rules"."multiplier" IS NULL) <> ("premium_rules"."flat_add_pence_per_hour" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `premium_rules_job_id_idx` ON `premium_rules` (`job_id`);--> statement-breakpoint
CREATE TABLE `rota_patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`cycle_length_days` integer NOT NULL,
	`start_date` text NOT NULL,
	`days` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rota_patterns_job_id_idx` ON `rota_patterns` (`job_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`unpaid_break_minutes` integer NOT NULL,
	`colour` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shift_templates_job_id_idx` ON `shift_templates` (`job_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
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
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shifts_job_id_date_idx` ON `shifts` (`job_id`,`date`);