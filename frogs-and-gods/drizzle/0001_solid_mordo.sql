CREATE TABLE `encounters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partyId` int,
	`frogId` int,
	`enemy_data` text NOT NULL,
	`status` enum('active','victory','defeat','fled') NOT NULL DEFAULT 'active',
	`current_turn` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `encounters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frog_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`frogId` int NOT NULL,
	`lootId` int NOT NULL,
	`equipped_slot` varchar(32),
	`acquiredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frog_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`level` int NOT NULL DEFAULT 1,
	`xp` int NOT NULL DEFAULT 0,
	`xpToNextLevel` int NOT NULL DEFAULT 100,
	`hp` int NOT NULL DEFAULT 100,
	`maxHp` int NOT NULL DEFAULT 100,
	`mp` int NOT NULL DEFAULT 50,
	`maxMp` int NOT NULL DEFAULT 50,
	`attack` int NOT NULL DEFAULT 15,
	`defense` int NOT NULL DEFAULT 10,
	`speed` int NOT NULL DEFAULT 10,
	`is_dead` boolean NOT NULL DEFAULT false,
	`partyId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `frogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gods` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`divine_power` int NOT NULL DEFAULT 100,
	`total_interventions` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gods_id` PRIMARY KEY(`id`),
	CONSTRAINT `gods_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `loot` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`tier` int NOT NULL DEFAULT 1,
	`rarity_label` varchar(32) NOT NULL,
	`attack_bonus` int NOT NULL DEFAULT 0,
	`defense_bonus` int NOT NULL DEFAULT 0,
	`hp_bonus` int NOT NULL DEFAULT 0,
	`mp_bonus` int NOT NULL DEFAULT 0,
	`drop_rate` float NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loot_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `parties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`leaderId` int NOT NULL,
	`max_size` int NOT NULL DEFAULT 4,
	`is_active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `parties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `party_invites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partyId` int NOT NULL,
	`invitedFrogId` int NOT NULL,
	`invitedByFrogId` int NOT NULL,
	`status` enum('pending','accepted','declined') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `party_invites_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `world_log_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`encounter_id` int,
	`frog_id` int,
	`god_id` int,
	`event_type` varchar(64) NOT NULL,
	`payload` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `world_log_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('frog','god','admin') NOT NULL DEFAULT 'frog';