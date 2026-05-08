CREATE TYPE "public"."action_status" AS ENUM('pending', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_type" AS ENUM('HUNTER', 'REACTIVE', 'DOCILE');--> statement-breakpoint
CREATE TYPE "public"."enemy_type" AS ENUM('SNAKE', 'FLY');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."owner_type" AS ENUM('frog', 'god', 'world_drop', 'void');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('frog', 'god', 'admin');--> statement-breakpoint
CREATE TABLE "frogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"current_xp" integer DEFAULT 0 NOT NULL,
	"xp_to_next_level" integer DEFAULT 100 NOT NULL,
	"current_hp" integer DEFAULT 100 NOT NULL,
	"current_mana" integer DEFAULT 50 NOT NULL,
	"current_condition" varchar(64) DEFAULT 'healthy' NOT NULL,
	"grid_x" integer DEFAULT 0 NOT NULL,
	"grid_y" integer DEFAULT 0 NOT NULL,
	"is_dead" boolean DEFAULT false NOT NULL,
	"partyId" integer,
	"stats_json" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gods" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"divine_power" integer DEFAULT 100 NOT NULL,
	"total_interventions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gods_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"rarity_tier" integer DEFAULT 1 NOT NULL,
	"stats_json" jsonb NOT NULL,
	"owner_type" "owner_type" DEFAULT 'world_drop' NOT NULL,
	"owner_id" integer,
	"grid_x" integer,
	"grid_y" integer,
	"remaining_ticks" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"leaderId" integer NOT NULL,
	"max_size" integer DEFAULT 4 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"partyId" integer NOT NULL,
	"invitedFrogId" integer NOT NULL,
	"invitedByFrogId" integer NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" integer NOT NULL,
	"action_type" varchar(64) NOT NULL,
	"target_grid_x" integer,
	"target_grid_y" integer,
	"resolve_bucket" bigint NOT NULL,
	"payload" jsonb,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predators" (
	"id" serial PRIMARY KEY NOT NULL,
	"enemy_type" "enemy_type" NOT NULL,
	"ai_type" "ai_type" NOT NULL,
	"grid_x" integer NOT NULL,
	"grid_y" integer NOT NULL,
	"chunk_x" integer NOT NULL,
	"chunk_y" integer NOT NULL,
	"current_hp" integer NOT NULL,
	"last_meal_tick" integer DEFAULT 0 NOT NULL,
	"stats_json" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"role" "role" DEFAULT 'frog' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "world_log_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tick_id" integer,
	"frog_id" integer,
	"god_id" integer,
	"event_type" varchar(64) NOT NULL,
	"payload" text NOT NULL,
	"chunk_x" integer,
	"chunk_y" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_map_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chunk_x" integer NOT NULL,
	"chunk_y" integer NOT NULL,
	"chunk_size" integer DEFAULT 16 NOT NULL,
	"biome" varchar(32) DEFAULT 'grassland' NOT NULL,
	"terrain_data_json" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"last_loaded_at" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_map_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"chunk_x" integer NOT NULL,
	"chunk_y" integer NOT NULL,
	"grid_x" integer NOT NULL,
	"grid_y" integer NOT NULL,
	"new_char" varchar(4) NOT NULL,
	"author_god_id" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "resolve_status_idx" ON "pending_actions" USING btree ("resolve_bucket","status");--> statement-breakpoint
CREATE INDEX "status_resolved_at_idx" ON "pending_actions" USING btree ("status","resolved_at");--> statement-breakpoint
CREATE INDEX "chunk_predator_idx" ON "predators" USING btree ("chunk_x","chunk_y");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_chunk_pos" ON "world_map_chunks" USING btree ("chunk_x","chunk_y");--> statement-breakpoint
CREATE INDEX "chunk_override_idx" ON "world_map_overrides" USING btree ("chunk_x","chunk_y");