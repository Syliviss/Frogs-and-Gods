import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  encounters,
  frogInventory,
  frogs,
  gods,
  loot,
  parties,
  partyInvites,
  users,
  worldLogEvents,
  type Encounter,
  type Frog,
  type God,
  type InsertEncounter,
  type InsertFrog,
  type InsertGod,
  type InsertParty,
  type InsertWorldLogEvent,
  type Party,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

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

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value !== undefined) {
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    }
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }

  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
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

export async function getFrogByUserId(userId: number): Promise<Frog | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(frogs).where(eq(frogs.userId, userId)).limit(1);
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
  data: Partial<Omit<Frog, "id" | "userId" | "createdAt">>
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

  await db
    .update(partyInvites)
    .set({ status: "accepted" })
    .where(eq(partyInvites.id, inviteId));

  await db.update(frogs).set({ partyId: invite[0].partyId }).where(eq(frogs.id, frogId));

  const party = await getPartyById(invite[0].partyId);
  return party ?? null;
}

// ─────────────────────────────────────────────
// ENCOUNTERS
// ─────────────────────────────────────────────

export async function createEncounter(data: InsertEncounter): Promise<Encounter> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(encounters).values(data);
  const result = await db
    .select()
    .from(encounters)
    .orderBy(desc(encounters.createdAt))
    .limit(1);
  return result[0]!;
}

export async function getEncounterById(id: number): Promise<Encounter | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(encounters).where(eq(encounters.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function updateEncounter(
  id: number,
  data: Partial<Omit<Encounter, "id" | "createdAt">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(encounters).set(data).where(eq(encounters.id, id));
}

export async function getActiveEncounters(): Promise<Encounter[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(encounters).where(eq(encounters.status, "active"));
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
// LOOT
// ─────────────────────────────────────────────

export async function getLootByTier(tier: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(loot).where(eq(loot.tier, tier));
}

export async function grantLootToFrog(frogId: number, lootId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(frogInventory).values({ frogId, lootId });
}

export async function getFrogInventory(frogId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(frogInventory).where(eq(frogInventory.frogId, frogId));
}
