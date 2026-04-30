ALTER TABLE `world_map_chunks` CHANGE `tile_data` `terrain_data_json` text;
--> statement-breakpoint
ALTER TABLE `world_map_chunks` ADD `overrides_json` text;
