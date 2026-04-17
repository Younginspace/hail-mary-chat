CREATE TABLE `register_rate_limit` (
	`ip` text NOT NULL,
	`hour_bucket` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`ip`, `hour_bucket`)
);
