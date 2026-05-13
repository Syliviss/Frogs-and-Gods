import { and, count, desc, eq, gte, inArray, isNotNull, lte, not, or, sql } from "drizzle-orm";
import { GOD_ACTION_TYPES } from "./actions/_god_action_types";
import { PREDATOR_ACTION_TYPES } from "./actions/_predator_action_types";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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
      const client = postgres(process.env.DATABASE_URL);
      _db = drizzle(client);
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

  await db.insert(users).values(values).onConflictDoUpdate({
    target: users.openId,
    set: updateSet,
  });
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

export async function getFrogsInBounds(
  minGX: number, maxGX: number,
  minGY: number, maxGY: number,
): Promise<Frog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(frogs).where(and(
    gte(frogs.gridX, minGX), lte(frogs.gridX, maxGX),
    gte(frogs.gridY, minGY), lte(frogs.gridY, maxGY),
  ));
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
  const [party] = await db.insert(parties).values(data).returning();
  return party!;
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

  await db.transaction(async (tx) => {
    await tx.update(partyInvites).set({ status: "accepted" }).where(eq(partyInvites.id, inviteId));
    await tx.update(frogs).set({ partyId: invite[0].partyId }).where(eq(frogs.id, frogId));
  });

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
  const [{ id }] = await db
    .insert(users)
    .values({ openId, name, role: "frog", lastSignedIn: new Date() })
    .returning({ id: users.id });
  return id;
}

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS
// ─────────────────────────────────────────────

export async function createWorldMapChunk(data: InsertWorldMapChunk): Promise<WorldMapChunk> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [chunk] = await db
    .insert(worldMapChunks)
    .values(data)
    .onConflictDoUpdate({
      target: [worldMapChunks.chunkX, worldMapChunks.chunkY],
      set: { terrainDataJson: data.terrainDataJson, biome: data.biome, updatedAt: new Date() },
    })
    .returning();
  return chunk!;
}

export async function batchCreateWorldMapChunks(chunks: InsertWorldMapChunk[]): Promise<void> {
  if (chunks.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(worldMapChunks)
    .values(chunks)
    .onConflictDoUpdate({
      target: [worldMapChunks.chunkX, worldMapChunks.chunkY],
      set: {
        terrainDataJson: sql`excluded.terrain_data_json`,
        biome:           sql`excluded.biome`,
        updatedAt:       sql`now()`,
      },
    });
}

export async function getAllChunkBiomes(): Promise<
  { chunkX: number; chunkY: number; biome: string }[]
> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ chunkX: worldMapChunks.chunkX, chunkY: worldMapChunks.chunkY, biome: worldMapChunks.biome })
    .from(worldMapChunks);
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

export async function getChunksInBoundingBox(
  minCX: number, maxCX: number,
  minCY: number, maxCY: number,
): Promise<WorldMapChunk[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(worldMapChunks).where(and(
    gte(worldMapChunks.chunkX, minCX), lte(worldMapChunks.chunkX, maxCX),
    gte(worldMapChunks.chunkY, minCY), lte(worldMapChunks.chunkY, maxCY),
  ));
}

// ─────────────────────────────────────────────
// WORLD MAP OVERRIDES
// ─────────────────────────────────────────────

export async function createWorldMapOverride(data: InsertWorldMapOverride): Promise<WorldMapOverride> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [override] = await db.insert(worldMapOverrides).values(data).returning();
  return override!;
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
  const [item] = await db.insert(items).values(data).returning();
  return item!;
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

export async function getItemsInBounds(
  minGX: number, maxGX: number,
  minGY: number, maxGY: number,
): Promise<Item[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(items).where(and(
    isNotNull(items.gridX),
    isNotNull(items.gridY),
    gte(items.gridX, minGX), lte(items.gridX, maxGX),
    gte(items.gridY, minGY), lte(items.gridY, maxGY),
  ));
}

export async function getGroundItemsNear(gridX: number, gridY: number, range: number): Promise<Item[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(items).where(and(
    eq(items.itemState, "GROUND"),
    isNotNull(items.gridX),
    isNotNull(items.gridY),
    gte(items.gridX, gridX - range), lte(items.gridX, gridX + range),
    gte(items.gridY, gridY - range), lte(items.gridY, gridY + range),
  ));
}

export async function getItemById(itemId: string): Promise<Item | null> {
  const db = await getDb();
  if (!db) return null;
  const [item] = await db.select().from(items).where(eq(items.itemId, itemId));
  return item ?? null;
}

export async function getItemPixelDataByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ itemId: items.itemId, pixelData: items.pixelData })
    .from(items)
    .where(inArray(items.itemId, ids));
}

export async function getEquippedItemsByFrogId(frogId: number): Promise<Item[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(items).where(
    and(eq(items.itemState, "EQUIPPED"), eq(items.ownerId, frogId))
  );
}

export async function getInventoryItemsByFrogId(frogId: number): Promise<Item[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(items).where(
    and(eq(items.itemState, "INVENTORY"), eq(items.ownerId, frogId))
  );
}

export async function getCountOfEquippedItems(frogId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ cnt: count() }).from(items).where(
    and(eq(items.itemState, "EQUIPPED"), eq(items.ownerId, frogId))
  );
  return row?.cnt ?? 0;
}

export async function getCountOfInventoryItems(frogId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ cnt: count() }).from(items).where(
    and(
      or(eq(items.itemState, "INVENTORY"), eq(items.itemState, "EQUIPPED")),
      eq(items.ownerId, frogId)
    )
  );
  return row?.cnt ?? 0;
}

export async function updateItem(itemId: string, data: Partial<Omit<Item, "itemId" | "createdAt">>): Promise<Item> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [updated] = await db.update(items).set(data).where(eq(items.itemId, itemId)).returning();
  return updated!;
}

/** Returns true if the frog has ANY action still in "pending" status (not yet resolved).
 *  Used as the Poise gate at tRPC submission time: while a deferred action (e.g. SWING)
 *  is sitting in the queue waiting for its resolveBucket, no new actions may be submitted.
 *  NOTE: Do NOT call this inside runAction() — it would block the action from resolving itself. */
export async function hasPendingActionForFrog(frogId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ cnt: count() })
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.actorId, frogId),
        eq(pendingActions.status,  "pending"),
      ),
    );
  return (row?.cnt ?? 0) > 0;
}

export async function hasFrogActedThisHeartbeat(frogId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const currentHeartbeat = Math.floor(Date.now() / 10000);
  const bucketMin = currentHeartbeat * 20;
  const bucketMax = (currentHeartbeat + 1) * 20;
  const [row] = await db.select({ cnt: count() }).from(pendingActions).where(
    and(
      eq(pendingActions.actorId, frogId),
      eq(pendingActions.status, "resolved"),
      gte(pendingActions.resolveBucket, bucketMin),
      lte(pendingActions.resolveBucket, bucketMax - 1),
    )
  );
  return (row?.cnt ?? 0) > 0;
}

// ─────────────────────────────────────────────
// PENDING ACTIONS
// ─────────────────────────────────────────────

export async function createPendingAction(data: InsertPendingAction): Promise<PendingAction> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db.insert(pendingActions).values(data).returning();
  return row!;
}

export async function getPendingActionsToResolve(currentBucket: number): Promise<PendingAction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingActions)
    .where(and(
      eq(pendingActions.status, "pending"),
      lte(pendingActions.resolveBucket, currentBucket),
      not(inArray(pendingActions.actionType, [...GOD_ACTION_TYPES, ...PREDATOR_ACTION_TYPES])),
    ));
}

export async function getPendingGodActions(currentBucket: number): Promise<PendingAction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingActions)
    .where(and(
      eq(pendingActions.status, "pending"),
      lte(pendingActions.resolveBucket, currentBucket),
      inArray(pendingActions.actionType, [...GOD_ACTION_TYPES]),
    ));
}

export async function purgeDeadFrogs(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.transaction(async (tx) => {
    const deadFrogs = await tx.select({ id: frogs.id }).from(frogs).where(eq(frogs.isDead, true));
    const deadIds = deadFrogs.map((f) => f.id);
    if (deadIds.length === 0) return;
    await tx.update(items)
      .set({ itemState: "VOID", ownerId: null, gridX: null, gridY: null })
      .where(inArray(items.ownerId, deadIds));
    await tx.delete(frogs).where(inArray(frogs.id, deadIds));
    console.log(`[Cleanup] Purged ${deadIds.length} dead frog(s) and voided their items.`);
  });
}

export async function purgeResolvedActions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(
    sql`DELETE FROM pending_actions WHERE status = 'resolved' AND resolved_at < NOW() - INTERVAL '20 seconds'`
  );
  const deletedCount = (result as unknown as { count: number }).count ?? 0;
  if (deletedCount > 0) {
    console.log(`[Cleanup] Purged ${deletedCount} resolved actions from the pond.`);
  }
  return deletedCount;
}

// ─────────────────────────────────────────────
// PREDATORS
// ─────────────────────────────────────────────

export async function createPredator(data: InsertPredator): Promise<Predator> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [predator] = await db.insert(predators).values(data).returning();
  return predator!;
}

export async function getPredatorsByChunk(chunkX: number, chunkY: number): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(predators)
    .where(and(eq(predators.chunkX, chunkX), eq(predators.chunkY, chunkY)));
}

export async function getPredatorsInChunkArea(
  coords: { chunkX: number; chunkY: number }[],
): Promise<Predator[]> {
  const db = await getDb();
  if (!db || coords.length === 0) return [];
  const conditions = coords.map((c) =>
    and(eq(predators.chunkX, c.chunkX), eq(predators.chunkY, c.chunkY))
  );
  return db.select().from(predators).where(or(...conditions));
}

/** Returns all frogs standing on an exact tile. Used by area-of-effect actions (e.g. SWING). */
export async function getFrogsAtTile(gridX: number, gridY: number): Promise<Frog[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(frogs).where(
    and(eq(frogs.gridX, gridX), eq(frogs.gridY, gridY)),
  );
}

/** Returns all predators standing on an exact tile. Used by area-of-effect actions (e.g. SWING). */
export async function getPredatorsAtTile(gridX: number, gridY: number): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(predators).where(
    and(eq(predators.gridX, gridX), eq(predators.gridY, gridY)),
  );
}

export async function updatePredatorHp(predatorId: number, newHp: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(predators).set({ currentHp: newHp }).where(eq(predators.id, predatorId));
}

export async function getPredatorById(id: number): Promise<Predator | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(predators).where(eq(predators.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getActivePredators(): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(predators);
}

export async function updatePredator(
  id: number,
  data: Partial<Omit<Predator, "id" | "createdAt">>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(predators).set(data).where(eq(predators.id, id));
}

export async function getWrappingPredators(): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(predators)
    .where(sql`stats_json->>'wrapping' IS NOT NULL`);
}

export async function listRecentPredators(limit: number): Promise<Predator[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(predators).orderBy(desc(predators.id)).limit(limit);
}

export async function deletePredator(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(predators).where(eq(predators.id, id));
}

export async function getPendingPredatorActions(currentBucket: number): Promise<PendingAction[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingActions)
    .where(and(
      eq(pendingActions.status, "pending"),
      lte(pendingActions.resolveBucket, currentBucket),
      inArray(pendingActions.actionType, [...PREDATOR_ACTION_TYPES]),
    ));
}
