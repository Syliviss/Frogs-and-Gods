ALTER TABLE `pending_actions` ADD `resolved_at` timestamp;--> statement-breakpoint
CREATE INDEX `status_resolved_at_idx` ON `pending_actions` (`status`,`resolved_at`);