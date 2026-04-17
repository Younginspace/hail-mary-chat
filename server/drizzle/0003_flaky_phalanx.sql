CREATE TABLE `audio_cache` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`lang` text NOT NULL,
	`voice_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_api_usage` (
	`date` text NOT NULL,
	`api` text NOT NULL,
	`scope` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `api`, `scope`)
);
--> statement-breakpoint
CREATE INDEX `idx_usage_date_api` ON `daily_api_usage` (`date`,`api`);--> statement-breakpoint
CREATE TABLE `voice_credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_user_ts` ON `voice_credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `voice_credits` integer DEFAULT 10 NOT NULL;