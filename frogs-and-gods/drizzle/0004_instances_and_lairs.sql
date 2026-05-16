-- Migration: God's Lair instanced dungeon system
-- Creates instances + lair_entrances tables and adds instanceId FK to entities

CREATE TABLE IF NOT EXISTS "instances" (
  "id"                      serial PRIMARY KEY,
  "owner_god_id"            integer NOT NULL REFERENCES "gods"("id"),
  "tile_data_json"          text,
  "staged_tile_data_json"   text,
  "created_at"              timestamp DEFAULT now() NOT NULL,
  "updated_at"              timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "idx_instances_owner" ON "instances"("owner_god_id");

CREATE TABLE IF NOT EXISTS "lair_entrances" (
  "id"          serial PRIMARY KEY,
  "instance_id" integer NOT NULL REFERENCES "instances"("id"),
  "grid_x"      integer NOT NULL,
  "grid_y"      integer NOT NULL,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "unique_entrance_pos" UNIQUE ("grid_x", "grid_y")
);

CREATE INDEX "idx_lair_entrances_instance" ON "lair_entrances"("instance_id");

ALTER TABLE "frogs"     ADD COLUMN IF NOT EXISTS "instance_id" integer REFERENCES "instances"("id");
ALTER TABLE "predators" ADD COLUMN IF NOT EXISTS "instance_id" integer REFERENCES "instances"("id");
ALTER TABLE "items"     ADD COLUMN IF NOT EXISTS "instance_id" integer REFERENCES "instances"("id");

CREATE INDEX "idx_frogs_instance"     ON "frogs"("instance_id");
CREATE INDEX "idx_predators_instance" ON "predators"("instance_id");
CREATE INDEX "idx_items_instance"     ON "items"("instance_id");
