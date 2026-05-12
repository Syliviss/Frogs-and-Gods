import { chebyshevDistance } from "../../shared/movement";
import { getFrogsInBounds, createPendingAction } from "../db";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { Predator, PredatorStats } from "../../drizzle/schema";

// ─────────────────────────────────────────────
// SNAKE AI — Sub-Tick Initiative
// ─────────────────────────────────────────────
//
// Called at Tick 0 (cycle_start) of each heartbeat.
// The snake decides its action for the upcoming cycle and queues it as a
// pending_action with a future resolveBucket based on the initiative formula:
//
//   Action Tick = ((10 - speed) * 2) + d4_roll
//   resolveBucket = currentBucket + Action Tick
//
// Speed 10 → delay 1–4 sub-ticks (~0.5–2s)
// Speed 5  → delay 11–14 sub-ticks (~5.5–7s)
// Speed 1  → delay 19–22 sub-ticks (may spill into the next heartbeat)
//
// State machine:
//   wrapping != null → STRIKE the trapped frog again
//   not hungry       → idle (lastMealTick within 18 heartbeats = 3 minutes)
//   hungry + frog adjacent   → STRIKE
//   hungry + frog in chunk   → SLITHER toward closest frog
//   hungry + no frog in chunk → idle
//
// Hunger: stored as heartbeat number (Math.floor(Date.now() / 10_000)).
// Hungry when: currentHeartbeat - lastMealTick > 18.

export async function calculateSnakeIntent(predator: Predator): Promise<void> {
  const stats = (predator.statsJson ?? {}) as PredatorStats;

  // Find frogs in the snake's 16×16 chunk (needed for both wrapping and hunting)
  const minGX = predator.chunkX * CHUNK_SIZE;
  const maxGX = minGX + CHUNK_SIZE - 1;
  const minGY = predator.chunkY * CHUNK_SIZE;
  const maxGY = minGY + CHUNK_SIZE - 1;
  const frogs = await getFrogsInBounds(minGX, maxGX, minGY, maxGY);
  const alive = frogs.filter((f) => !f.isDead);

  if (stats.wrapping) {
    // Still coiled — keep striking the trapped frog
    const target = alive.find((f) => f.id === stats.wrapping!.targetFrogId);
    if (!target) return; // frog escaped or died; idle until wrapping flag is cleared
    const speed         = stats.speed ?? 5;
    const d4            = Math.ceil(Math.random() * 4);
    const delay         = ((10 - speed) * 2) + d4;
    const currentBucket = Math.floor(Date.now() / 500);
    await createPendingAction({
      actorId:       predator.id,
      actionType:    "STRIKE",
      targetGridX:   target.gridX,
      targetGridY:   target.gridY,
      resolveBucket: currentBucket + delay,
      payload:       { targetFrogId: target.id },
    });
    return;
  }

  // Hunger check: 18 heartbeats = 3 minutes
  const currentHeartbeat = Math.floor(Date.now() / 10_000);
  const isHungry = currentHeartbeat - predator.lastMealTick > 18;
  if (!isHungry) return;

  if (alive.length === 0) return;

  // Find closest frog by Chebyshev distance
  let closestFrog = alive[0]!;
  let closestDist = chebyshevDistance(predator.gridX, predator.gridY, closestFrog.gridX, closestFrog.gridY);
  for (const frog of alive.slice(1)) {
    const d = chebyshevDistance(predator.gridX, predator.gridY, frog.gridX, frog.gridY);
    if (d < closestDist) {
      closestFrog = frog;
      closestDist = d;
    }
  }

  // Determine action type, target tile, and payload
  let actionType: string;
  let targetGridX: number;
  let targetGridY: number;
  let payload: Record<string, unknown>;

  if (closestDist <= 1) {
    // Adjacent — lunge. Store frog ID so the inhale can preload them into state.
    actionType  = "STRIKE";
    targetGridX = closestFrog.gridX;
    targetGridY = closestFrog.gridY;
    payload     = { targetFrogId: closestFrog.id };
  } else {
    // Slither one Chebyshev step toward the closest frog
    actionType  = "SLITHER";
    targetGridX = predator.gridX + Math.sign(closestFrog.gridX - predator.gridX);
    targetGridY = predator.gridY + Math.sign(closestFrog.gridY - predator.gridY);
    payload     = {};
  }

  // Roll initiative: Action Tick = ((10 - speed) * 2) + d4
  const speed  = stats.speed ?? 5;
  const d4     = Math.ceil(Math.random() * 4); // 1–4
  const delay  = ((10 - speed) * 2) + d4;
  const currentBucket  = Math.floor(Date.now() / 500);
  const resolveBucket  = currentBucket + delay;

  await createPendingAction({
    actorId: predator.id,
    actionType,
    targetGridX,
    targetGridY,
    resolveBucket,
    payload,
  });
}
