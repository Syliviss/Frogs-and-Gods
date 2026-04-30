import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  float,
} from "drizzle-orm/mysql-core";

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** "frog" = mortal grinder, "god" = divine watcher */
  role: mysqlEnum("role", ["frog", "god", "admin"]).default("frog").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─────────────────────────────────────────────
// FROGS  (mortal player characters)
// ─────────────────────────────────────────────

export const frogs = mysqlTable("frogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  level: int("level").default(1).notNull(),
  xp: int("xp").default(0).notNull(),
  xpToNextLevel: int("xpToNextLevel").default(100).notNull(),
  hp: int("hp").default(100).notNull(),
  maxHp: int("maxHp").default(100).notNull(),
  mp: int("mp").default(50).notNull(),
  maxMp: int("maxMp").default(50).notNull(),
  attack: int("attack").default(15).notNull(),
  defense: int("defense").default(10).notNull(),
  speed: int("speed").default(10).notNull(),
  /** Authoritative permadeath flag */
  isDead: boolean("is_dead").default(false).notNull(),
  partyId: int("partyId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Frog = typeof frogs.$inferSelect;
export type InsertFrog = typeof frogs.$inferInsert;

// ─────────────────────────────────────────────
// GODS  (divine watcher players)
// ─────────────────────────────────────────────

export const gods = mysqlTable("gods", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  /** Currency spent on interventions */
  divinePower: int("divine_power").default(100).notNull(),
  totalInterventions: int("total_interventions").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type God = typeof gods.$inferSelect;
export type InsertGod = typeof gods.$inferInsert;

// ─────────────────────────────────────────────
// PARTIES  (social groupings of Frogs)
// ─────────────────────────────────────────────

export const parties = mysqlTable("parties", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  leaderId: int("leaderId").notNull(),
  maxSize: int("max_size").default(4).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Party = typeof parties.$inferSelect;
export type InsertParty = typeof parties.$inferInsert;

// ─────────────────────────────────────────────
// PARTY INVITES
// ─────────────────────────────────────────────

export const partyInvites = mysqlTable("party_invites", {
  id: int("id").autoincrement().primaryKey(),
  partyId: int("partyId").notNull(),
  invitedFrogId: int("invitedFrogId").notNull(),
  invitedByFrogId: int("invitedByFrogId").notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "declined"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PartyInvite = typeof partyInvites.$inferSelect;
export type InsertPartyInvite = typeof partyInvites.$inferInsert;

// ─────────────────────────────────────────────
// LOOT  (12-tier rarity system)
// ─────────────────────────────────────────────

export const loot = mysqlTable("loot", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  /** Tier 1 = Common … Tier 12 = Mythic Transcendent */
  tier: int("tier").default(1).notNull(),
  rarityLabel: varchar("rarity_label", { length: 32 }).notNull(),
  attackBonus: int("attack_bonus").default(0).notNull(),
  defenseBonus: int("defense_bonus").default(0).notNull(),
  hpBonus: int("hp_bonus").default(0).notNull(),
  mpBonus: int("mp_bonus").default(0).notNull(),
  dropRate: float("drop_rate").default(1.0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Loot = typeof loot.$inferSelect;
export type InsertLoot = typeof loot.$inferInsert;

// ─────────────────────────────────────────────
// FROG INVENTORY
// ─────────────────────────────────────────────

export const frogInventory = mysqlTable("frog_inventory", {
  id: int("id").autoincrement().primaryKey(),
  frogId: int("frogId").notNull(),
  lootId: int("lootId").notNull(),
  equippedSlot: varchar("equipped_slot", { length: 32 }),
  acquiredAt: timestamp("acquiredAt").defaultNow().notNull(),
});

export type FrogInventory = typeof frogInventory.$inferSelect;

// ─────────────────────────────────────────────
// ENCOUNTERS  (active combat sessions)
// ─────────────────────────────────────────────

export const encounters = mysqlTable("encounters", {
  id: int("id").autoincrement().primaryKey(),
  partyId: int("partyId"),
  frogId: int("frogId"),
  /** Enemy data stored as JSON string */
  enemyData: text("enemy_data").notNull(),
  status: mysqlEnum("status", ["active", "victory", "defeat", "fled"]).default("active").notNull(),
  currentTurn: int("current_turn").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Encounter = typeof encounters.$inferSelect;
export type InsertEncounter = typeof encounters.$inferInsert;

// ─────────────────────────────────────────────
// WORLD LOG EVENTS  (broadcast to Gods)
// ─────────────────────────────────────────────

export const worldLogEvents = mysqlTable("world_log_events", {
  id: int("id").autoincrement().primaryKey(),
  encounterId: int("encounter_id"),
  frogId: int("frog_id"),
  godId: int("god_id"),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  /** Full event payload as JSON */
  payload: text("payload").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorldLogEvent = typeof worldLogEvents.$inferSelect;
export type InsertWorldLogEvent = typeof worldLogEvents.$inferInsert;

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS  (lazy-loaded 16×16 tile chunks)
// ─────────────────────────────────────────────

export const worldMapChunks = mysqlTable("world_map_chunks", {
  id:           int("id").autoincrement().primaryKey(),
  chunkX:       int("chunk_x").notNull(),
  chunkY:       int("chunk_y").notNull(),
  chunkSize:    int("chunk_size").default(16).notNull(),
  biome:        varchar("biome", { length: 32 }).default("grassland").notNull(),
  terrainDataJson: text("terrain_data_json"),
  overridesJson:   text("overrides_json"),
  isActive:        boolean("is_active").default(false).notNull(),
  entityCount:  int("entity_count").default(0).notNull(),
  lastLoadedAt: timestamp("last_loaded_at"),
  createdAt:    timestamp("createdAt").defaultNow().notNull(),
  updatedAt:    timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueChunkPos: uniqueIndex("unique_chunk_pos").on(table.chunkX, table.chunkY),
}));

export type WorldMapChunk = typeof worldMapChunks.$inferSelect;
export type InsertWorldMapChunk = typeof worldMapChunks.$inferInsert;

// ─────────────────────────────────────────────
// ITEMS  (1-of-1 economy — every item is unique)
// ─────────────────────────────────────────────

export const items = mysqlTable("items", {
  itemId:          varchar("item_id", { length: 36 }).primaryKey(),
  name:            varchar("name", { length: 128 }).notNull(),
  rarityTier:      int("rarity_tier").default(1).notNull(),
  statsJson:       text("stats_json").notNull(),
  ownerType:       mysqlEnum("owner_type", ["frog", "god", "world_drop", "void"])
                     .default("world_drop").notNull(),
  ownerId:         int("owner_id"),
  locationDropped: varchar("location_dropped", { length: 128 }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Item = typeof items.$inferSelect;
export type InsertItem = typeof items.$inferInsert;
