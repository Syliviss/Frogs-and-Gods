import { chebyshevDistance } from "../../shared/movement";
import {
  getFrogsInBounds,
  getFrogsByInstanceId,
  createPendingAction,
  updateItem,
  deletePredator,
  awardChunkXpDirect,
} from "../db";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { Predator, Frog } from "../../drizzle/schema";

// ─────────────────────────────────────────────
// GOLEM AI — calculateGolemIntent
// ─────────────────────────────────────────────
//
// Called at Tick 0 (cycle_start) of each heartbeat.
// Golems are stationary 3×3 tile creatures. They never move except when
// they land a kill, at which point they reposition onto the dead frog's tile.
//
// Priority logic:
//   1. Starvation check — despawn after 540 heartbeats (~90 min) without a kill.
//   2. Scan frogs in the 3×3 chunk neighborhood; filter to those within crush range.
//   3. If any are in range, queue CRUSH targeting the closest one.
//   4. Otherwise idle (do nothing).
//
// Crush range: Chebyshev ≤ 2 from the nearest golem tile to the target.
// Initiative:  delay = ((10 - speed) * 2) + d4, where speed defaults to 3.

const GOLEM_STARVE_THRESHOLD = 540;

function distanceToGolem(cx: number, cy: number, fx: number, fy: number): number {
  const nearestX = Math.max(cx - 1, Math.min(cx + 1, fx));
  const nearestY = Math.max(cy - 1, Math.min(cy + 1, fy));
  return chebyshevDistance(nearestX, nearestY, fx, fy);
}

async function getAliveFrogs(predator: Predator): Promise<Frog[]> {
  if (predator.instanceId != null) {
    const all = await getFrogsByInstanceId(predator.instanceId);
    return all.filter(f => !f.isDead);
  }
  const minGX = (predator.chunkX - 1) * CHUNK_SIZE;
  const maxGX = (predator.chunkX + 2) * CHUNK_SIZE - 1;
  const minGY = (predator.chunkY - 1) * CHUNK_SIZE;
  const maxGY = (predator.chunkY + 2) * CHUNK_SIZE - 1;
  const all = await getFrogsInBounds(minGX, maxGX, minGY, maxGY);
  return all.filter(f => !f.isDead);
}

async function queueGolemAction(
  predator: Predator,
  actionType: string,
  targetGridX: number,
  targetGridY: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const speed = (predator.statsJson as { speed?: number })?.speed ?? 3;
  const d4 = Math.ceil(Math.random() * 4);
  const delay = ((10 - speed) * 2) + d4;
  const currentBucket = Math.floor(Date.now() / 500);
  await createPendingAction({
    actorId: predator.id,
    actionType,
    targetGridX,
    targetGridY,
    resolveBucket: currentBucket + delay,
    payload,
  });
}

export async function calculateGolemIntent(predator: Predator): Promise<void> {
  // ── 0. Starvation check ────────────────────────────────────────
  const currentHeartbeat = Math.floor(Date.now() / 10_000);
  if (currentHeartbeat - predator.lastMealTick > GOLEM_STARVE_THRESHOLD) {
    for (const itemId of predator.lootItems ?? []) {
      await updateItem(itemId, {
        itemState:  "GROUND",
        gridX:      predator.gridX,
        gridY:      predator.gridY,
        ownerId:    null,
        instanceId: predator.instanceId ?? null,
      });
    }
    await awardChunkXpDirect(predator);
    await deletePredator(predator.id);
    return;
  }

  // ── 1. Scan frogs, filter to crush range ──────────────────────
  const frogs = await getAliveFrogs(predator);
  const cx = predator.gridX;
  const cy = predator.gridY;

  const inRange = frogs.filter(f => distanceToGolem(cx, cy, f.gridX, f.gridY) <= 2);
  if (inRange.length === 0) return;

  // Closest first; tie-break by id for determinism
  inRange.sort((a, b) => {
    const dA = distanceToGolem(cx, cy, a.gridX, a.gridY);
    const dB = distanceToGolem(cx, cy, b.gridX, b.gridY);
    return dA !== dB ? dA - dB : a.id - b.id;
  });
  const target = inRange[0]!;

  await queueGolemAction(predator, "CRUSH", target.gridX, target.gridY, { targetFrogId: target.id });
}
