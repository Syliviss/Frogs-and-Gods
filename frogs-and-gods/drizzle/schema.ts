import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export const users = mysqlTable("users", {
  id:           int("id").autoincrement().primaryKey(),
  openId:       varchar("openId", { length: 64 }).notNull().unique(),
  name:         text("name"),
  /** "frog" = mortal grinder, "god" = divine watcher, "admin" = console access */
  role:         mysqlEnum("role", ["frog", "god", "admin"]).default("frog").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User       = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─────────────────────────────────────────────
// FROGS  (mortal player characters)
// ─────────────────────────────────────────────

export interface FrogStats {
  maxHp:   number;
  maxMana: number;
  str:     number;
  dex:     number;
  wis:     number;
  int:     number;
  cha:     number;
}

export const DEFAULT_FROG_STATS: FrogStats = {
  maxHp:   100,
  maxMana: 50,
  str:     10,
  dex:     10,
  wis:     10,
  int:     10,
  cha:     10,
};

export const frogs = mysqlTable("frogs", {
  id:               int("id").autoincrement().primaryKey(),
  ownerId:          int("ownerId").notNull(),
  name:             varchar("name", { length: 64 }).notNull(),
  level:            int("level").default(1).notNull(),
  currentXp:        int("current_xp").default(0).notNull(),
  xpToNextLevel:    int("xp_to_next_level").default(100).notNull(),
  currentHp:        int("current_hp").default(100).notNull(),
  currentMana:      int("current_mana").default(50).notNull(),
  /** e.g. "healthy" | "poisoned" | "stunned" | "cursed" | "blessed" */
  currentCondition: varchar("current_condition", { length: 64 }).default("healthy").notNull(),
  /** Absolute tile X position in the world grid */
  gridX:            int("grid_x").default(0).notNull(),
  /** Absolute tile Y position in the world grid */
  gridY:            int("grid_y").default(0).notNull(),
  isDead:           boolean("is_dead").default(false).notNull(),
  partyId:          int("partyId"),
  /** Flexible stats: maxHp, maxMana, str, dex, wis, int, cha */
  statsJson:        json("stats_json").$type<FrogStats>().notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Frog       = typeof frogs.$inferSelect;
export type InsertFrog = typeof frogs.$inferInsert;

// ─────────────────────────────────────────────
// GODS  (divine watcher players)
// ─────────────────────────────────────────────

export const gods = mysqlTable("gods", {
  id:                 int("id").autoincrement().primaryKey(),
  userId:             int("userId").notNull().unique(),
  name:               varchar("name", { length: 64 }).notNull(),
  /** Currency spent on interventions */
  divinePower:        int("divine_power").default(100).notNull(),
  totalInterventions: int("total_interventions").default(0).notNull(),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type God       = typeof gods.$inferSelect;
export type InsertGod = typeof gods.$inferInsert;

// ─────────────────────────────────────────────
// PARTIES  (social groupings of Frogs)
// ─────────────────────────────────────────────

export const parties = mysqlTable("parties", {
  id:        int("id").autoincrement().primaryKey(),
  name:      varchar("name", { length: 64 }).notNull(),
  leaderId:  int("leaderId").notNull(),
  maxSize:   int("max_size").default(4).notNull(),
  isActive:  boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Party       = typeof parties.$inferSelect;
export type InsertParty = typeof parties.$inferInsert;

// ─────────────────────────────────────────────
// PARTY INVITES
// ─────────────────────────────────────────────

export const partyInvites = mysqlTable("party_invites", {
  id:              int("id").autoincrement().primaryKey(),
  partyId:         int("partyId").notNull(),
  invitedFrogId:   int("invitedFrogId").notNull(),
  invitedByFrogId: int("invitedByFrogId").notNull(),
  status:          mysqlEnum("status", ["pending", "accepted", "declined"]).default("pending").notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type PartyInvite       = typeof partyInvites.$inferSelect;
export type InsertPartyInvite = typeof partyInvites.$inferInsert;

// ─────────────────────────────────────────────
// ITEMS  (vault — 1-of-1 economy)
// ─────────────────────────────────────────────

export interface ItemStats {
  attackBonus?:    number;
  defenseBonus?:   number;
  hpBonus?:        number;
  /** Unique action this item can trigger (e.g. "ACTION_DEVOUR") */
  actionType?:     string;
  visionModifier?: number;
  [key: string]:   unknown;
}

export const items = mysqlTable("items", {
  itemId:          varchar("item_id", { length: 36 }).primaryKey(),
  name:            varchar("name", { length: 128 }).notNull(),
  rarityTier:      int("rarity_tier").default(1).notNull(),
  /** Flexible stats + unique action definitions */
  statsJson:       json("stats_json").$type<ItemStats>().notNull(),
  ownerType:       mysqlEnum("owner_type", ["frog", "god", "world_drop", "void"]).default("world_drop").notNull(),
  ownerId:         int("owner_id"),
  /** Absolute tile X — set when ownerType = "world_drop" */
  gridX:           int("grid_x"),
  /** Absolute tile Y — set when ownerType = "world_drop" */
  gridY:           int("grid_y"),
  /** Chrono-Relic cooldown: decremented by 1 each heartbeat tick */
  remainingTicks:  int("remaining_ticks").default(0).notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Item       = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;

// ─────────────────────────────────────────────
// PENDING ACTIONS  (heartbeat queue)
// ─────────────────────────────────────────────

export const pendingActions = mysqlTable("pending_actions", {
  id:           int("id").autoincrement().primaryKey(),
  /** Frog that submitted this action */
  actorId:      int("actor_id").notNull(),
  /** e.g. "HOP", "STRIKE", "USE_ITEM" */
  actionType:   varchar("action_type", { length: 64 }).notNull(),
  /** Target tile X (null for non-spatial actions) */
  targetGridX:  int("target_grid_x"),
  /** Target tile Y */
  targetGridY:  int("target_grid_y"),
  /** Which 10-second window this action belongs to */
  lockedInTick: int("locked_in_tick").notNull(),
  /** Sub-tick bucket (0–19) from the heartbeat engine */
  bucketId:     int("bucket_id").notNull(),
  /** Optional extra payload (item id, target frog id, etc.) */
  payload:      json("payload"),
  status:       mysqlEnum("status", ["pending", "resolved", "cancelled"]).default("pending").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("tick_status_idx").on(table.lockedInTick, table.status),
]);

export type PendingAction       = typeof pendingActions.$inferSelect;
export type InsertPendingAction = typeof pendingActions.$inferInsert;

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS  (lazy-loaded 16×16 tile chunks)
// ─────────────────────────────────────────────

export const worldMapChunks = mysqlTable("world_map_chunks", {
  id:              int("id").autoincrement().primaryKey(),
  chunkX:          int("chunk_x").notNull(),
  chunkY:          int("chunk_y").notNull(),
  chunkSize:       int("chunk_size").default(16).notNull(),
  biome:           varchar("biome", { length: 32 }).default("grassland").notNull(),
  terrainDataJson: text("terrain_data_json"),
  isActive:        boolean("is_active").default(false).notNull(),
  entityCount:     int("entity_count").default(0).notNull(),
  lastLoadedAt:    timestamp("last_loaded_at"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("unique_chunk_pos").on(table.chunkX, table.chunkY),
]);

export type WorldMapChunk       = typeof worldMapChunks.$inferSelect;
export type InsertWorldMapChunk = typeof worldMapChunks.$inferInsert;

// ─────────────────────────────────────────────
// WORLD MAP OVERRIDES  (God-placed terrain changes)
// ─────────────────────────────────────────────

export const worldMapOverrides = mysqlTable("world_map_overrides", {
  id:           int("id").autoincrement().primaryKey(),
  chunkX:       int("chunk_x").notNull(),
  chunkY:       int("chunk_y").notNull(),
  /** Absolute tile X */
  gridX:        int("grid_x").notNull(),
  /** Absolute tile Y */
  gridY:        int("grid_y").notNull(),
  /** Replacement ASCII tile character (e.g. "#", "~") */
  newChar:      varchar("new_char", { length: 4 }).notNull(),
  authorGodId:  int("author_god_id"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("chunk_override_idx").on(table.chunkX, table.chunkY),
]);

export type WorldMapOverride       = typeof worldMapOverrides.$inferSelect;
export type InsertWorldMapOverride = typeof worldMapOverrides.$inferInsert;

// ─────────────────────────────────────────────
// PREDATORS  (ecosystem entities: snakes, flies)
// ─────────────────────────────────────────────

export interface PredatorStats {
  /** Current movement path or patrol points */
  path?:       number[][];
  /** Unique mutation flags */
  mutations?:  string[];
  [key: string]: unknown;
}

export const predators = mysqlTable("predators", {
  id:           int("id").autoincrement().primaryKey(),
  enemyType:    mysqlEnum("enemy_type", ["SNAKE", "FLY"]).notNull(),
  aiType:       mysqlEnum("ai_type", ["HUNTER", "REACTIVE", "DOCILE"]).notNull(),
  gridX:        int("grid_x").notNull(),
  gridY:        int("grid_y").notNull(),
  /** Stored directly for fast spatial queries (derived: Math.floor(gridX / 16)) */
  chunkX:       int("chunk_x").notNull(),
  chunkY:       int("chunk_y").notNull(),
  currentHp:    int("current_hp").notNull(),
  /** Dedicated column — enables fast WHERE currentTick - lastMealTick > 180 queries */
  lastMealTick: int("last_meal_tick").default(0).notNull(),
  /** Flexible AI state, mutations, path data */
  statsJson:    json("stats_json").$type<PredatorStats>(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("chunk_predator_idx").on(table.chunkX, table.chunkY),
]);

export type Predator       = typeof predators.$inferSelect;
export type InsertPredator = typeof predators.$inferInsert;

// ─────────────────────────────────────────────
// WORLD LOG EVENTS  (broadcast to Gods)
// ─────────────────────────────────────────────

export const worldLogEvents = mysqlTable("world_log_events", {
  id:        int("id").autoincrement().primaryKey(),
  tickId:    int("tick_id"),
  frogId:    int("frog_id"),
  godId:     int("god_id"),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  /** Full event payload as JSON string */
  payload:   text("payload").notNull(),
  /** Chunk coordinates for God viewport filtering */
  chunkX:    int("chunk_x"),
  chunkY:    int("chunk_y"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorldLogEvent       = typeof worldLogEvents.$inferSelect;
export type InsertWorldLogEvent = typeof worldLogEvents.$inferInsert;
