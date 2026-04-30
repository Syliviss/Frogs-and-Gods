CREATE TABLE `items` (
	`item_id` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`rarity_tier` int NOT NULL DEFAULT 1,
	`stats_json` text NOT NULL,
	`owner_type` enum('frog','god','world_drop','void') NOT NULL DEFAULT 'world_drop',
	`owner_id` int,
	`location_dropped` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `items_item_id` PRIMARY KEY(`item_id`)
);
--> statement-breakpoint
CREATE TABLE `world_map_chunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chunk_x` int NOT NULL,
	`chunk_y` int NOT NULL,
	`chunk_size` int NOT NULL DEFAULT 16,
	`biome` varchar(32) NOT NULL DEFAULT 'grassland',
	`tile_data` text,
	`is_active` boolean NOT NULL DEFAULT false,
	`entity_count` int NOT NULL DEFAULT 0,
	`last_loaded_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `world_map_chunks_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_chunk_pos` UNIQUE(`chunk_x`,`chunk_y`)
);
