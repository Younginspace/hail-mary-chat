CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`lang` text NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`summary_tokens` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_started` ON `sessions` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`email` text,
	`callsign` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_device_id_unique` ON `users` (`device_id`);--> statement-breakpoint
CREATE INDEX `idx_users_device_id` ON `users` (`device_id`);