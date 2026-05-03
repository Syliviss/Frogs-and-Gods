import { and, count, desc, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  DEFAULT_FROG_STATS,
  frogs,
  gods,
  items,
  parties,
  partyInvites,
  pendingActions,
  predators,
  users,
  worldLogEvents,
  worldMapChunks,
  worldMapOverrides,
  type Frog,
  type God,
  type InsertFrog,
  type InsertGod,
  type InsertItem,
  type InsertParty,
  type InsertPendingAction,
  type InsertPredator,
  type InsertUser,
  type InsertWorldLogEvent,
  type InsertWorldMapChunk,
  type InsertWorldMapOverride,
  type Item,
  type Party,
  type PendingAction,
  type Predator,
  type WorldMapChunk,
  type WorldMapOverride,
} from "../drizzle/schema";

// ─────────────────────────────────────────────
// DB SINGLETON
// ─────────────────────────────────────────────

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  if (user.name !== undefined) {
    values.name = user.name ?? null;
    updateSet.name = user.name ?? null;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}

// ─────────────────────────────────────────────
// FROGS
// ─────────────────────────────────────────────

export async function createFrog(data: InsertFrog): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(frogs).values(data);
}

export async function getFrogByOwnerId(ownerId: number): Promise<Frog | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(frogs).where(eq(frogs.ownerId, ownerId)).limit(1);
  return result[0] ?? undefined;
}

export async function getFrogById(id: number): Promise<Frog | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(frogs).where(eq(frogs.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function updateFrog(
  id: number,
  data: Partial<Omit<Frog, "id" | "ownerId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(frogs).set(data).where(eq(frogs.id, id));
}

export async function getFrogsByPartyId(partyId: number): Promise<Frog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(frogs).where(eq(frogs.partyId, partyId));
}

// ─────────────────────────────────────────────
// GODS
// ─────────────────────────────────────────────

export async function createGod(data: InsertGod): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(gods).values(data);
}

export async function getGodByUserId(userId: number): Promise<God | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(gods).where(eq(gods.userId, userId)).limit(1);
  return result[0] ?? undefined;
}

export async function getGodById(id: number): Promise<God | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(gods).where(eq(gods.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function updateGod(
  id: number,
  data: Partial<Omit<God, "id" | "userId" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(gods).set(data).where(eq(gods.id, id));
}

// ─────────────────────────────────────────────
// PARTIES
// ─────────────────────────────────────────────

export async function createParty(data: InsertParty): Promise<Party> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(parties).values(data);
  const result = await db
    .select()
    .from(parties)
    .where(eq(parties.leaderId, data.leaderId))
    .orderBy(desc(parties.createdAt))
    .limit(1);
  return result[0]!;
}

export async function getPartyById(id: number): Promise<Party | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(parties).where(eq(parties.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function createPartyInvite(
  partyId: number,
  invitedFrogId: number,
  invitedByFrogId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(partyInvites).values({ partyId, invitedFrogId, invitedByFrogId });
}

export async function getPendingInvitesForFrog(frogId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(partyInvites)
    .where(and(eq(partyInvites.invitedFrogId, frogId), eq(partyInvites.status, "pending")));
}

export async function acceptPartyInvite(inviteId: number, frogId: number): Promise<Party | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const invite = await db
    .select()
    .from(partyInvites)
    .where(and(eq(partyInvites.id, inviteId), eq(partyInvites.invitedFrogId, frogId)))
    .limit(1);

  if (!invite[0] || invite[0].status !== "pending") return null;

  await db.update(partyInvites).set({ status: "accepted" }).where(eq(partyInvites.id, inviteId));
  await db.update(frogs).set({ partyId: invite[0].partyId }).where(eq(frogs.id, frogId));

  const party = await getPartyById(invite[0].partyId);
  return party ?? null;
}

// ─────────────────────────────────────────────
// WORLD LOG
// ─────────────────────────────────────────────

export async function createWorldLogEvent(data: InsertWorldLogEvent): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(worldLogEvents).values(data);
}

export async function getRecentWorldLog(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(worldLogEvents)
    .orderBy(desc(worldLogEvents.createdAt))
    .limit(limit);
}

// ─────────────────────────────────────────────
// ADMIN HELPERS
// ─────────────────────────────────────────────

export async function listAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users);
}

export async function setUserRole(userId: number, role: "frog" | "god" | "admin"): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function listAllFrogs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(frogs);
}

export async function listAllGods() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gods);
}

export async function createUserWithOpenId(openId: string, name: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(users).values({ openId, name, role: "frog", lastSignedIn: new Date() });
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0]!.id;
}

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS
// ─────────────────────────────────────────────

export async function createWorldMapChunk(data: InsertWorldMapChunk): Promise<WorldMapChunk> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(worldMapChunks).values(data).onDuplicateKeyUpdate({
    set: { terrainDataJson: data.terrainDataJson, biome: data.biome, updatedAt: new Date() },
  });
  const result = await db
    .select()
    .from(worldMapChunks)
    .where(and(
      eq(worldMapChunks.chunkX, data.chunkX!),
      eq(worldMapChunks.chunkY, data.chunkY!)
    ))
    .limit(1);
  return result[0]!;
}

export async function getWorldChunkStats(): Promise<{ totalChunks: number; activeChunks: number }> {
  const db = await getDb();
  if (!db) return { totalChunks: 0, activeChunks: 0 };
  const [totalResult, activeResult] = await Promise.all([
    db.select({ value: count() }).from(worldMapChunks),
    db.select({ value: count() }).from(worldMapChunks).where(eq(worldMapChunks.isActive, true)),
  ]);
  return {
    totalChunks:  totalResult[0]?.value  ?? 0,
    activeChunks: activeResult[0]?.value ?? 0,
  };
}

export async function listWorldMapChunks(): Promise<WorldMapChunk[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(worldMapChunks).orderBy(worldMapChunks.chunkX, worldMapChunks.chunkY);
}

export async function getChunksByCoords(
  coords: { chunkX: number; chunkY: number }[]
): Promise<WorldMapChunk[]> {
  const db = await getDb();
  if (!db || coords.length === 0) return [];
  const conditions = coords.map((c) =>
    and(eq(worldMapChunks.chunkX, c.chunkX), eq(worldMapChunks.chunkY, c.chunkY))
  );
  return db.select().from(worldMapChunks).where(or(...conditions));
}

// ─────────────────────────────────────────────
// WORLD MAP OVERRIDES
// ─────────────────────────────────────────────

export async function createWorldMapOverride(data: InsertWorldMapOverride): Promise<WorldMapOverride> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(worldMapOverrides).values(data);
  const result = await db
    .select()
    .from(worldMapOverrides)
    .where(and(eq(worldMapOverrides.gridX, data.gridX), eq(worldMapOverrides.gridY, data.gridY)))
    .orderBy(desc(worldMapOverrides.createdAt))
    .limit(1);
  return result[0]!;
}

export async function getOverridesByChunk(chunkX: number, chunkY: number): Promise<WorldMapOverride[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(worldMapOverrides)
    .where(and(eq(worldMapOverrides.chunkX, chunkX), eq(worldMapOverrides.chunkY, chunkY)));
}

// ─────────────────────────────────────────────
// ITEMS (vault — 1-of-1)
// ─────────────────────────────────────────────

export async function createItem(data: InsertItem): Promise<Item> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(items).values(data);
  const result = await db.select().from(items).where(eq(items.itemId, data.itemId)).limit(1);
  return result[0]!;
}

export async function listRecentItems(limit = 50): Promise<Item[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(items).orderBy(desc(items.createdAt)).limit(limit);
}

export async function getItemStats(): Promise<{ totalItems: number; itemsByTier: Record<number, number> }> {
  const db = await getDb();
  if (!db) return { totalItems: 0, itemsByTier: {} };

  const [totalResult, byTierResult] = await Promise.all([
    db.select({ value: count() }).from(items),
    db.select({ tier: items.rarityTier, cnt: count() }).from(items).groupBy(items.rarityTier),
  ]);

  const itemsByTier: Record<number, number> = {};
  for (const row of byTierResult) itemsByTier[row.tier] = row.cnt;

  return { totalItems: totalResult[0]?.value ?? 0, itemsByTier };
}

// ─────────────────────────────────────────────
// PENDING ACTIONS
// ─────────────────────────────────────────────

export async function createPendingAction(data: InsertPendingAction): Promise<PendingAction> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(pendingActions).values(data);
  const result = await db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.id, data.id ?? 0))
    .orderBy(desc(pendingActions.createdAt))
    .limit(1);
  return result[0]!;
}

export async function getPendingActionsByTick(lockedInTick: number): Promise<PendingAction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.lockedInTick, lockedInTick), eq(pendingActions.status, "pending")));
}

export async function resolvePendingActions(lockedInTick: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(pendingActions)
    .set({ status: "resolved" })
    .where(and(eq(pendingActions.lockedInTick, lockedInTick), eq(pendingActions.status, "pending")));
}

// ─────────────────────────────────────────────
// PREDATORS
// ─────────────────────────────────────────────

export async function createPredator(data: InsertPredator): Promise<Predator> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(predators).values(data);
  const result = await db
    .select()
    .from(predators)
    .orderBy(desc(predators.createdAt))
    .limit(1);
  return result[0]!;
}

export async function getPredatorsByChunk(chunkX: number, chunkY: number): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(predators)
    .where(and(eq(predators.chunkX, chunkX), eq(predators.chunkY, chunkY)));
}
