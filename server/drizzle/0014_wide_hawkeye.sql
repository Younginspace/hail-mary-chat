ALTER TABLE `sessions` ADD `last_active_at` integer;--> statement-breakpoint
CREATE INDEX `idx_sessions_open_active` ON `sessions` (`ended_at`,`last_active_at`);