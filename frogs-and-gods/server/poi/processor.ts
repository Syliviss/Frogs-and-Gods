import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, getActivePois, decrementDormantPois, getFrogsInBounds } from "../db";
import {
  predators,
  pointsOfInterest,
  items,
  type Frog,
  type InsertPredator,
  type InsertItem,
  type PointOfInterest,
} from "../../drizzle/schema";
import { CHUNK_SIZE } from "../worldgen/generator";
import { getPoiTypeDef } from "./registry";
import type { ItemSpawnSpec, PredatorSpawnSpec } from "./types";

// Builds a predator row from a spawn spec, positioned relative to the POI anchor.
// aiType is hardcoded to "HUNTER" — the column is required by the DB schema, but no
// AI code branches on its value yet. When REACTIVE/DOCILE behavior is implemented,
// reintroduce aiType on PredatorSpawnSpec and thread it through here.
function buildPredatorRow(poi: PointOfInterest, spec: PredatorSpawnSpec): InsertPredator {
  const gridX = poi.gridX + spec.dx;
  const gridY = poi.gridY + spec.dy;
  const statsJson = spec.enemyType === "GOLEM"
    ? { speed: spec.speed }
    : { speed: spec.speed, segments: [{ x: gridX - 1, y: gridY }, { x: gridX - 2, y: gridY }] };
  return {
    enemyType:    spec.enemyType,
    aiType:       "HUNTER",
    gridX,
    gridY,
    chunkX:       Math.floor(gridX / CHUNK_SIZE),
    chunkY:       Math.floor(gridY / CHUNK_SIZE),
    currentHp:    spec.hp,
    lastMealTick: Math.floor(Date.now() / 10_000),
    statsJson,
  };
}

// Builds a GROUND item row from a spawn spec. Caller decides whether to insert based
// on its probability roll. Spawned items aren't tracked by the POI — they persist on
// the ground until a frog picks them up (cleanup only handles spawned predators).
function buildItemRow(poi: PointOfInterest, spec: ItemSpawnSpec): InsertItem {
  return {
    itemId:     randomUUID(),
    name:       spec.name,
    rarityTier: spec.rarityTier,
    statsJson:  spec.statsJson,
    itemState:  "GROUND",
    itemType:   "STANDARD",
    lootType:   spec.lootType,
    ownerId:    null,
    gridX:      poi.gridX + spec.dx,
    gridY:      poi.gridY + spec.dy,
    instanceId: poi.instanceId ?? null,
  };
}

function hasFrogInNeighborhood(frogs: Frog[], poi: PointOfInterest): boolean {
  return frogs.some(f =>
    Math.abs(Math.floor(f.gridX / CHUNK_SIZE) - poi.chunkX) <= 1 &&
    Math.abs(Math.floor(f.gridY / CHUNK_SIZE) - poi.chunkY) <= 1
  );
}

// The POI heartbeat pass — a self-contained inhale → process → exhale unit, run once
// per heartbeat from runEngineBroadcast() before ENGINE_TICK is broadcast.
//
//   status -1 / 0 : if a frog is in the 3×3 chunk neighborhood, run startup (once)
//                   and hold at -1; if not, start the grace countdown (cleanupDelay).
//   status 2      : cleanup — delete spawned predators, reset triggered, go dormant (1).
//   status >= 3   : bulk-decremented toward cleanup (handled by decrementDormantPois).
export async function runPoiHeartbeatPass(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // ── Inhale ──
  const activePois = await getActivePois();          // status IN (-1, 0, 2)
  await decrementDormantPois();                      // grace countdown for status >= 3
  if (activePois.length === 0) return;

  // Load frogs across the union of every -1/0 POI's 3×3 chunk neighborhood.
  const checkPois = activePois.filter(p => p.status === -1 || p.status === 0);
  let frogs: Frog[] = [];
  if (checkPois.length > 0) {
    let minGX = Infinity, maxGX = -Infinity, minGY = Infinity, maxGY = -Infinity;
    for (const p of checkPois) {
      minGX = Math.min(minGX, (p.chunkX - 1) * CHUNK_SIZE);
      maxGX = Math.max(maxGX, (p.chunkX + 2) * CHUNK_SIZE - 1);
      minGY = Math.min(minGY, (p.chunkY - 1) * CHUNK_SIZE);
      maxGY = Math.max(maxGY, (p.chunkY + 2) * CHUNK_SIZE - 1);
    }
    frogs = await getFrogsInBounds(minGX, maxGX, minGY, maxGY);
  }

  // ── Process ──
  const spawnJobs: { poiId: number; rows: InsertPredator[]; items: InsertItem[] }[] = [];
  const updates: { id: number; changes: Partial<typeof pointsOfInterest.$inferInsert> }[] = [];
  const predatorIdsToDelete: number[] = [];

  for (const poi of activePois) {
    const def = getPoiTypeDef(poi.poiType);
    if (!def) {
      console.warn(`[POI] Unknown poiType "${poi.poiType}" (id ${poi.id}) — skipping.`);
      continue;
    }

    if (poi.status === 2) {
      if (poi.spawnedPredatorIds.length > 0) predatorIdsToDelete.push(...poi.spawnedPredatorIds);
      updates.push({ id: poi.id, changes: { status: 1, triggered: false, spawnedPredatorIds: [] } });
      continue;
    }

    // status -1 or 0
    if (hasFrogInNeighborhood(frogs, poi)) {
      if (poi.triggered) {
        updates.push({ id: poi.id, changes: { status: -1 } });
      } else {
        const predatorRows = def.startup(poi).map(s => buildPredatorRow(poi, s));
        const itemRows = (def.startupItems?.(poi) ?? [])
          .filter(spec => Math.random() < spec.probability)
          .map(spec => buildItemRow(poi, spec));
        spawnJobs.push({ poiId: poi.id, rows: predatorRows, items: itemRows });
      }
    } else {
      updates.push({ id: poi.id, changes: { status: def.cleanupDelay } });
    }
  }

  // ── Exhale ──
  if (spawnJobs.length === 0 && updates.length === 0 && predatorIdsToDelete.length === 0) return;

  await db.transaction(async (tx) => {
    for (const job of spawnJobs) {
      let ids: number[] = [];
      if (job.rows.length > 0) {
        const inserted = await tx.insert(predators).values(job.rows).returning({ id: predators.id });
        ids = inserted.map(r => r.id);
      }
      if (job.items.length > 0) {
        await tx.insert(items).values(job.items);
      }
      await tx.update(pointsOfInterest)
        .set({ status: -1, triggered: true, spawnedPredatorIds: ids })
        .where(eq(pointsOfInterest.id, job.poiId));
    }
    for (const u of updates) {
      await tx.update(pointsOfInterest).set(u.changes).where(eq(pointsOfInterest.id, u.id));
    }
    if (predatorIdsToDelete.length > 0) {
      await tx.delete(predators).where(inArray(predators.id, predatorIdsToDelete));
    }
  });
}
