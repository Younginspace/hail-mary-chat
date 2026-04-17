CREATE TABLE `daily_global_locks` (
	`date` text NOT NULL,
	`api` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`limit` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`date`, `api`)
);
--> statement-breakpoint
CREATE TABLE `gifts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`description` text,
	`r2_key` text,
	`r2_bucket` text,
	`source_session` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_gifts_user_created` ON `gifts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `media_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gift_id` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`external_task_id` text,
	`external_url` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_media_tasks_user_created` ON `media_tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_fallback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`gift_id` text,
	`choice` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
