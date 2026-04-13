CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`source_session` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`superseded_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_session`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_memories_user_imp` ON `memories` (`user_id`,`importance`);--> statement-breakpoint
CREATE TABLE `rapport` (
	`user_id` text PRIMARY KEY NOT NULL,
	`trust` real DEFAULT 0.3 NOT NULL,
	`warmth` real DEFAULT 0.3 NOT NULL,
	`last_mood` text,
	`notes` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
