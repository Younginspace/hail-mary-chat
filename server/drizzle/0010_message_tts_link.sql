ALTER TABLE `messages` ADD `tts_content_hash` text;--> statement-breakpoint
CREATE INDEX `idx_messages_tts_hash` ON `messages` (`tts_content_hash`);