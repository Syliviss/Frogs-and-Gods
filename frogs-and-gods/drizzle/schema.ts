import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// ENUMS  (must be declared at file scope in pg-core)
// ─────────────────────────────────────────────

export const roleEnum         = pgEnum("role",           ["frog", "god", "admin"]);
export const itemStateEnum    = pgEnum("item_state",     ["VOID", "GROUND", "INVENTORY", "EQUIPPED", "ITEM", "GOD", "PREDATOR"]);
export const itemTypeEnum     = pgEnum("item_type",      ["STANDARD", "CONTAINER"]);
export const lootTypeEnum     = pgEnum("loot_type",      ["NONE", "SNAKE_LOOT", "GOLEM_LOOT"]);
export const actionStatusEnum = pgEnum("action_status",  ["pending", "resolved", "cancelled"]);
export const enemyTypeEnum    = pgEnum("enemy_type",     ["SNAKE", "FLY", "GOLEM"]);
export const aiTypeEnum       = pgEnum("ai_type",        ["HUNTER", "REACTIVE", "DOCILE"]);

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export const users = pgTable("users", {
  id:           serial("id").primaryKey(),
  openId:       varchar("openId", { length: 64 }).notNull().unique(),
  name:         text("name"),
  /** "frog" = mortal grinder, "god" = divine watcher, "admin" = console access */
  role:         roleEnum("role").default("frog").notNull(),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User       = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─────────────────────────────────────────────
// FROGS  (mortal player characters)
// ─────────────────────────────────────────────

export interface FrogStats {
  maxHp:               number;
  maxMana:             number;
  maxBreath:           number;
  str:                 number;
  dex:                 number;
  wis:                 number;
  int:                 number;
  cha:                 number;
  inventoryCapacity:   number;
  equipCapacity:       number;
  equippedAttackBonus: number;
  equippedDefenseBonus: number;
  equippedHpBonus:     number;
  /** Predator id currently constricting this frog. Null or absent = free. */
  wrappedBy?: number | null;
}

export const DEFAULT_FROG_STATS: FrogStats = {
  maxHp:               100,
  maxMana:             50,
  maxBreath:           5,
  str:                 10,
  dex:                 10,
  wis:                 10,
  int:                 10,
  cha:                 10,
  inventoryCapacity:   6,
  equipCapacity:       3,
  equippedAttackBonus: 0,
  equippedDefenseBonus: 0,
  equippedHpBonus:     0,
};

export const frogs = pgTable("frogs", {
  id:               serial("id").primaryKey(),
  ownerId:          integer("ownerId").notNull(),
  name:             varchar("name", { length: 64 }).notNull(),
  level:            integer("level").default(1).notNull(),
  currentXp:        integer("current_xp").default(0).notNull(),
  xpToNextLevel:    integer("xp_to_next_level").default(100).notNull(),
  currentHp:        integer("current_hp").default(100).notNull(),
  currentMana:      integer("current_mana").default(50).notNull(),
  currentBreath:    integer("current_breath").default(5).notNull(),
  /** e.g. "healthy" | "poisoned" | "stunned" | "cursed" | "blessed".
   *  NOTE: This column is reserved for future condition display but is NOT currently
   *  read by any action handler. Active conditions are stored in statsJson (e.g. wrappedBy).
   *  When a full condition system is built, this column should become the source of truth. */
  currentCondition: varchar("current_condition", { length: 64 }).default("healthy").notNull(),
  /** Absolute tile X position in the world grid */
  gridX:            integer("grid_x").default(0).notNull(),
  /** Absolute tile Y position in the world grid */
  gridY:            integer("grid_y").default(0).notNull(),
  isDead:           boolean("is_dead").default(false).notNull(),
  /** Flexible stats: maxHp, maxMana, str, dex, wis, int, cha */
  statsJson:        jsonb("stats_json").$type<FrogStats>().notNull(),
  /** 16×16 pixel art sprite — 256-element array of hex colors or null (transparent).
   *  Generated at creation from server/assets/frogModels.ts palette + template. */
  modelJson:        jsonb("model_json").$type<(string | null)[]>(),
  /** Null = overworld; N = inside instance with that id */
  instanceId:       integer("instance_id"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("idx_frogs_owner").on(table.ownerId),
  index("idx_frogs_grid").on(table.gridX, table.gridY),
  index("idx_frogs_instance").on(table.instanceId),
]);

export type Frog       = typeof frogs.$inferSelect;
export type InsertFrog = typeof frogs.$inferInsert;

// ─────────────────────────────────────────────
// GODS  (divine watcher players)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// INSTANCES  (God-owned 16×16 dungeon layouts)
// ─────────────────────────────────────────────

export const instances = pgTable("instances", {
  id:                  serial("id").primaryKey(),
  ownerGodId:          integer("owner_god_id").notNull(),
  /** Committed 16×16 ASCII layout (null = not yet finalized) */
  tileDataJson:        text("tile_data_json"),
  /** Pre-staged layout awaiting DIV_UPDATE_LAIR resolution */
  stagedTileDataJson:  text("staged_tile_data_json"),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("idx_instances_owner").on(table.ownerGodId),
]);

export type Instance       = typeof instances.$inferSelect;
export type InsertInstance = typeof instances.$inferInsert;

// ─────────────────────────────────────────────
// LAIR ENTRANCES  (overworld tiles that lead into an instance)
// ─────────────────────────────────────────────

export const lairEntrances = pgTable("lair_entrances", {
  id:         serial("id").primaryKey(),
  instanceId: integer("instance_id").notNull(),
  /** Absolute overworld tile X */
  gridX:      integer("grid_x").notNull(),
  /** Absolute overworld tile Y */
  gridY:      integer("grid_y").notNull(),
  createdAt:  timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("unique_entrance_pos").on(table.gridX, table.gridY),
  index("idx_lair_entrances_instance").on(table.instanceId),
]);

export type LairEntrance       = typeof lairEntrances.$inferSelect;
export type InsertLairEntrance = typeof lairEntrances.$inferInsert;

// ─────────────────────────────────────────────
// GODS  (divine watcher players)
// ─────────────────────────────────────────────

export const gods = pgTable("gods", {
  id:                 serial("id").primaryKey(),
  /** Null for admin-created system gods; set when a player registers as a god */
  userId:             integer("userId").unique(),
  name:               varchar("name", { length: 64 }).notNull(),
  /** Currency spent on interventions */
  favor:              integer("favor").default(100).notNull(),
  totalInterventions: integer("total_interventions").default(0).notNull(),
  /** 3 divine power IDs chosen at creation (e.g. ["HEAL_FROG", "SMITE_ENEMY", "SPAWN_ITEM"]) */
  startingPowers:     jsonb("starting_powers").$type<string[]>().default([]).notNull(),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type God       = typeof gods.$inferSelect;
export type InsertGod = typeof gods.$inferInsert;

// ─────────────────────────────────────────────
// ITEMS  (vault — 1-of-1 economy)
// ─────────────────────────────────────────────

/** Targeting parameters embedded in an item's stats_json.
 *  When present, clicking the action button enters targeting mode on the client.
 *  The server validates these parameters at both submission time and resolution time. */
export interface ActionSchema {
  action_name:  string;
  targeting: {
    type:               "TILE_SELECT";
    count:              number;
    adjacency_required: boolean;
    max_range:          number;
  };
  cast_time_ms: number;
}

export interface ItemStats {
  attackBonus?:    number;
  defenseBonus?:   number;
  hpBonus?:        number;
  /** Actions this item grants when EQUIPPED (e.g. ["TONGUE_STRIKE", "DEVOUR"]) */
  grantedActions?: string[];
  /** Actions this item blocks in the frog's inventory (triggers Fumble) */
  blockedActions?: string[];
  visionModifier?: number;
  /** Server-driven targeting schema — present on weapons that use the Generic Intent Builder */
  actionSchema?:   ActionSchema;
  [key: string]:   unknown;
}

export const items = pgTable("items", {
  itemId:            varchar("item_id", { length: 36 }).primaryKey(),
  name:              varchar("name", { length: 128 }).notNull(),
  rarityTier:        integer("rarity_tier").default(1).notNull(),
  /** Flexible stats + unique action definitions */
  statsJson:         jsonb("stats_json").$type<ItemStats>().notNull(),
  /** Where this item currently exists in the world */
  itemState:         itemStateEnum("item_state").default("GROUND").notNull(),
  /** STANDARD = plain item; CONTAINER = can hold other items (not other containers) */
  itemType:          itemTypeEnum("item_type").default("STANDARD").notNull(),
  /** Loot pool tag — SNAKE_LOOT items are eligible to spawn on hunting snakes */
  lootType:          lootTypeEnum("loot_type").default("NONE").notNull(),
  ownerId:           integer("owner_id"),
  /** Absolute tile X — set when itemState = "GROUND" */
  gridX:             integer("grid_x"),
  /** Absolute tile Y — set when itemState = "GROUND" */
  gridY:             integer("grid_y"),
  /** UUIDs of items stored inside this container (only relevant when itemType = "CONTAINER") */
  inventory:         jsonb("inventory").$type<string[]>().default([]).notNull(),
  /** UUID of the container item this item lives inside (set when itemState = "ITEM") */
  parentContainerId: varchar("parent_container_id", { length: 36 }),
  /** Chrono-Relic cooldown: decremented by 1 each heartbeat tick */
  remainingTicks:    integer("remaining_ticks").default(0).notNull(),
  /** 16×16 pixel art sprite — 256-element array of hex colors or null (transparent) */
  pixelData:         jsonb("pixel_data").$type<(string | null)[]>(),
  /** Null = overworld; N = inside instance with that id */
  instanceId:        integer("instance_id"),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("idx_items_owner_state").on(table.ownerId, table.itemState),
  index("idx_items_grid").on(table.gridX, table.gridY),
  index("idx_items_instance").on(table.instanceId),
]);

export type Item       = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;

// ─────────────────────────────────────────────
// PENDING ACTIONS  (heartbeat queue)
// ─────────────────────────────────────────────

export const pendingActions = pgTable("pending_actions", {
  id:           serial("id").primaryKey(),
  /** Frog that submitted this action */
  actorId:      integer("actor_id").notNull(),
  /** e.g. "HOP", "STRIKE", "USE_ITEM" */
  actionType:   varchar("action_type", { length: 64 }).notNull(),
  /** Target tile X (null for non-spatial actions) */
  targetGridX:  integer("target_grid_x"),
  /** Target tile Y */
  targetGridY:  integer("target_grid_y"),
  /** Absolute 500ms bucket at submission time: Math.floor(Date.now() / 500) */
  resolveBucket: bigint("resolve_bucket", { mode: "number" }).notNull(),
  /** Optional extra payload (item id, target frog id, etc.) */
  payload:      jsonb("payload"),
  status:       actionStatusEnum("status").default("pending").notNull(),
  /** Set when status transitions to resolved/cancelled; used for TTL purge */
  resolvedAt:   timestamp("resolved_at"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("resolve_status_idx").on(table.resolveBucket, table.status),
  index("status_resolved_at_idx").on(table.status, table.resolvedAt),
  index("idx_pending_actor_status").on(table.actorId, table.status),
]);

export type PendingAction       = typeof pendingActions.$inferSelect;
export type InsertPendingAction = typeof pendingActions.$inferInsert;

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS  (lazy-loaded 16×16 tile chunks)
// ─────────────────────────────────────────────

export const worldMapChunks = pgTable("world_map_chunks", {
  id:              serial("id").primaryKey(),
  chunkX:          integer("chunk_x").notNull(),
  chunkY:          integer("chunk_y").notNull(),
  chunkSize:       integer("chunk_size").default(16).notNull(),
  biome:           varchar("biome", { length: 32 }).default("grassland").notNull(),
  terrainDataJson: text("terrain_data_json"),
  isActive:        boolean("is_active").default(false).notNull(),
  entityCount:     integer("entity_count").default(0).notNull(),
  lastLoadedAt:    timestamp("last_loaded_at"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  uniqueIndex("unique_chunk_pos").on(table.chunkX, table.chunkY),
]);

export type WorldMapChunk       = typeof worldMapChunks.$inferSelect;
export type InsertWorldMapChunk = typeof worldMapChunks.$inferInsert;

// ─────────────────────────────────────────────
// WORLD MAP OVERRIDES  (God-placed terrain changes)
// ─────────────────────────────────────────────

export const worldMapOverrides = pgTable("world_map_overrides", {
  id:           serial("id").primaryKey(),
  chunkX:       integer("chunk_x").notNull(),
  chunkY:       integer("chunk_y").notNull(),
  /** Absolute tile X */
  gridX:        integer("grid_x").notNull(),
  /** Absolute tile Y */
  gridY:        integer("grid_y").notNull(),
  /** Replacement ASCII tile character (e.g. "#", "~") */
  newChar:      varchar("new_char", { length: 4 }).notNull(),
  authorGodId:  integer("author_god_id"),
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
  /** Body tiles trailing the head. Head position is gridX/gridY; segments[0] = body1, [1] = body2. */
  segments?:   Array<{ x: number; y: number }>;
  /** Initiative speed rating 1–10. Higher = acts sooner in the sub-tick bucket. */
  speed?:      number;
  /** Active constriction target. Null = snake is free to hunt. */
  wrapping?:   { targetFrogId: number } | null;
  /** Persisted 8-direction unit vector {dx,dy} ∈ {-1,0,1}². Set on first SLITHER, updated each move. */
  facing?:     { dx: number; dy: number };
  [key: string]: unknown;
}

export const predators = pgTable("predators", {
  id:           serial("id").primaryKey(),
  enemyType:    enemyTypeEnum("enemy_type").notNull(),
  aiType:       aiTypeEnum("ai_type").notNull(),
  gridX:        integer("grid_x").notNull(),
  gridY:        integer("grid_y").notNull(),
  /** Stored directly for fast spatial queries (derived: Math.floor(gridX / 16)) */
  chunkX:       integer("chunk_x").notNull(),
  chunkY:       integer("chunk_y").notNull(),
  currentHp:    integer("current_hp").notNull(),
  /** Dedicated column — enables fast WHERE currentTick - lastMealTick > 180 queries */
  lastMealTick: integer("last_meal_tick").default(0).notNull(),
  /** Flexible AI state, mutations, path data */
  statsJson:    jsonb("stats_json").$type<PredatorStats>(),
  /** UUIDs of items this predator carries — dropped at the head tile on death */
  lootItems:    jsonb("loot_items").$type<string[]>().default([]).notNull(),
  /** Null = overworld; N = inside instance with that id */
  instanceId:   integer("instance_id"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  index("chunk_predator_idx").on(table.chunkX, table.chunkY),
  index("idx_predators_instance").on(table.instanceId),
]);

export type Predator       = typeof predators.$inferSelect;
export type InsertPredator = typeof predators.$inferInsert;

// ─────────────────────────────────────────────
// POINTS OF INTEREST  (procedural stateful encounter locations)
// ─────────────────────────────────────────────

export const pointsOfInterest = pgTable("points_of_interest", {
  id:                 serial("id").primaryKey(),
  /** Library type key — matches a PoiTypeDef in server/poi/registry.ts */
  poiType:            varchar("poi_type", { length: 64 }).notNull(),
  /** Absolute anchor tile X */
  gridX:              integer("grid_x").notNull(),
  /** Absolute anchor tile Y */
  gridY:              integer("grid_y").notNull(),
  /** Denormalized Math.floor(grid / 16) for fast spatial queries */
  chunkX:             integer("chunk_x").notNull(),
  chunkY:             integer("chunk_y").notNull(),
  /** Lifecycle countdown. -1 = active, 0 = woken, 1 = dormant, 2 = cleanup, >=3 = grace countdown.
   *  The POI heartbeat pass pulls status IN (-1,0,2); status >=3 is bulk-decremented only. */
  status:             integer("status").default(1).notNull(),
  /** True once the startup function has run; reset to false on cleanup */
  triggered:          boolean("triggered").default(false).notNull(),
  /** Predator ids spawned by this POI's startup — cleanup deletes exactly these */
  spawnedPredatorIds: jsonb("spawned_predator_ids").$type<number[]>().default([]).notNull(),
  /** Null = overworld; N = inside instance with that id */
  instanceId:         integer("instance_id"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()).notNull(),
}, (table) => [
  uniqueIndex("unique_poi_pos").on(table.gridX, table.gridY),
  index("idx_poi_chunk").on(table.chunkX, table.chunkY),
  index("idx_poi_status").on(table.status),
]);

export type PointOfInterest       = typeof pointsOfInterest.$inferSelect;
export type InsertPointOfInterest = typeof pointsOfInterest.$inferInsert;

// ─────────────────────────────────────────────
// WORLD LOG EVENTS  (broadcast to Gods)
// ─────────────────────────────────────────────

export const worldLogEvents = pgTable("world_log_events", {
  id:        serial("id").primaryKey(),
  tickId:    integer("tick_id"),
  frogId:    integer("frog_id"),
  godId:     integer("god_id"),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  /** Full event payload as JSON string */
  payload:   text("payload").notNull(),
  /** Chunk coordinates for God viewport filtering */
  chunkX:    integer("chunk_x"),
  chunkY:    integer("chunk_y"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_worldlog_created_at").on(table.createdAt),
]);

export type WorldLogEvent       = typeof worldLogEvents.$inferSelect;
export type InsertWorldLogEvent = typeof worldLogEvents.$inferInsert;
