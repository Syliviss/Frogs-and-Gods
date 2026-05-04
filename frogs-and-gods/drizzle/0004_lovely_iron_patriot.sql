CREATE TABLE `predators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enemy_type` enum('SNAKE','FLY') NOT NULL,
	`ai_type` enum('HUNTER','REACTIVE','DOCILE') NOT NULL,
	`grid_x` int NOT NULL,
	`grid_y` int NOT NULL,
	`chunk_x` int NOT NULL,
	`chunk_y` int NOT NULL,
	`current_hp` int NOT NULL,
	`last_meal_tick` int NOT NULL DEFAULT 0,
	`stats_json` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `predators_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `world_map_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chunk_x` int NOT NULL,
	`chunk_y` int NOT NULL,
	`grid_x` int NOT NULL,
	`grid_y` int NOT NULL,
	`new_char` varchar(4) NOT NULL,
	`author_god_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `world_map_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP TABLE `frog_inventory`;--> statement-breakpoint
DROP TABLE `loot`;--> statement-breakpoint
RENAME TABLE `encounters` TO `pending_actions`;--> statement-breakpoint
ALTER TABLE `pending_actions` DROP PRIMARY KEY;--> statement-breakpoint
ALTER TABLE `pending_actions` MODIFY COLUMN `status` enum('pending','resolved','cancelled') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `items` MODIFY COLUMN `stats_json` json NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD PRIMARY KEY(`id`);--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `actor_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `action_type` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `target_grid_x` int;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `target_grid_y` int;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `resolve_bucket` bigint NOT NULL;--> statement-breakpoint
ALTER TABLE `pending_actions` ADD `payload` json;--> statement-breakpoint
ALTER TABLE `frogs` ADD `ownerId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `current_xp` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `xp_to_next_level` int DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `current_hp` int DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `current_mana` int DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `current_condition` varchar(64) DEFAULT 'healthy' NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `grid_x` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `grid_y` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `frogs` ADD `stats_json` json NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `grid_x` int;--> statement-breakpoint
ALTER TABLE `items` ADD `grid_y` int;--> statement-breakpoint
ALTER TABLE `items` ADD `remaining_ticks` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `world_log_events` ADD `tick_id` int;--> statement-breakpoint
ALTER TABLE `world_log_events` ADD `chunk_x` int;--> statement-breakpoint
ALTER TABLE `world_log_events` ADD `chunk_y` int;--> statement-breakpoint
ALTER TABLE `world_map_chunks` ADD `terrain_data_json` text;--> statement-breakpoint
CREATE INDEX `chunk_predator_idx` ON `predators` (`chunk_x`,`chunk_y`);--> statement-breakpoint
CREATE INDEX `chunk_override_idx` ON `world_map_overrides` (`chunk_x`,`chunk_y`);--> statement-breakpoint
CREATE INDEX `resolve_status_idx` ON `pending_actions` (`resolve_bucket`,`status`);--> statement-breakpoint
ALTER TABLE `pending_actions` DROP COLUMN `partyId`;--> statement-breakpoint
ALTER TABLE `pending_actions` DROP COLUMN `frogId`;--> statement-breakpoint
ALTER TABLE `pending_actions` DROP COLUMN `enemy_data`;--> statement-breakpoint
ALTER TABLE `pending_actions` DROP COLUMN `current_turn`;--> statement-breakpoint
ALTER TABLE `pending_actions` DROP COLUMN `updatedAt`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `userId`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `xp`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `xpToNextLevel`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `hp`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `maxHp`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `mp`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `maxMp`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `attack`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `defense`;--> statement-breakpoint
ALTER TABLE `frogs` DROP COLUMN `speed`;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `location_dropped`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `email`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `loginMethod`;--> statement-breakpoint
ALTER TABLE `world_log_events` DROP COLUMN `encounter_id`;--> statement-breakpoint
ALTER TABLE `world_map_chunks` DROP COLUMN `tile_data`;