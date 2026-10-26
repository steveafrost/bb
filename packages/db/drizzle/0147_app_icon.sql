CREATE TABLE IF NOT EXISTS `app_icon` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content_hash` text NOT NULL,
	`bytes` blob NOT NULL,
	`updated_at` integer NOT NULL
);
