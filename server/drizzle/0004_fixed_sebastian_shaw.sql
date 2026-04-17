CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`message_content` text NOT NULL,
	`mood` text,
	`lang` text NOT NULL,
	`source_session` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fav_user_hash` ON `favorites` (`user_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_fav_user_created` ON `favorites` (`user_id`,`created_at`);