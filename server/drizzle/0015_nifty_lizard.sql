CREATE TABLE `adoption_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_user_id` text,
	`ip` text NOT NULL,
	`error_code` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_adoption_failures_ts` ON `adoption_failures` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_adoption_failures_auth_user` ON `adoption_failures` (`auth_user_id`);--> statement-breakpoint
CREATE INDEX `idx_adoption_failures_ip_ts` ON `adoption_failures` (`ip`,`created_at`);