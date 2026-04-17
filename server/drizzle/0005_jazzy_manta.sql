CREATE TABLE `rapport_thresholds` (
	`level` integer PRIMARY KEY NOT NULL,
	`trust_min` real NOT NULL,
	`warmth_min` real NOT NULL,
	`combinator` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `affinity_level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pending_level_up` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `image_credits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `music_credits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `video_credits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `video_used_at` integer;--> statement-breakpoint
-- F6 beta thresholds (plan §review 2026-04-17). Re-tune after 500 users.
INSERT INTO `rapport_thresholds` (`level`, `trust_min`, `warmth_min`, `combinator`) VALUES
  (2, 0.45, 0.5, 'OR'),
  (3, 0.65, 0.6, 'AND'),
  (4, 0.85, 0.8, 'AND');