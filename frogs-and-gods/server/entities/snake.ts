import { chebyshevDistance } from "../../shared/movement";
import {
  getFrogsInBounds,
  getFrogsByInstanceId,
  createPendingAction,
  updatePredator,
  updateItem,
  deletePredator,
  getChunksByCoords,
} from "../db";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { Predator, PredatorStats, Frog } from "../../drizzle/schema";

// ─────────────────────────────────────────────
// SNAKE AI — calculateSnakeIntent
// ─────────────────────────────────────────────
//
// Called at Tick 0 (cycle_start) of each heartbeat.
// Queues exactly ONE pending_action (SLITHER or STRIKE) per call, or idles.
//
// Priority state machine:
//   1. WRAPPING   → keep striking the trapped frog (or auto-clear flag if frog is gone)
//   2. HUNGRY + frog within 3 tiles → STRIKE
//   3. HUNGRY + frogs exist but all farther away → SLITHER toward closest (coil)
//   4. Not hungry → SLITHER in wandering coil pattern
//   5. No walkable 2-tile path in any direction → idle, randomize facing
//
// Movement model:
//   - 2 tiles per SLITHER in a unit direction (8-directional)
//   - Terrain: only '#' (land) tiles; blocks water, peaks, lily pads, doors
//   - 50% chance to coil-turn: perpendicular whose destination is closest to a body segment
//   - Persistent facing stored in statsJson.facing between heartbeats
//
// Hunger: isHungry when currentHeartbeat - lastMealTick > 18 (≈ 3 minutes)
// Initiative: delay = ((10 - speed) * 2) + d4;  resolveBucket = currentBucket + delay

// ─────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────

type Dir = { dx: number; dy: number };

// All 8 unit directions, cardinal-first so fallback scans prefer cardinal movement
const ALL_DIRS: Dir[] = [
  { dx:  1, dy:  0 },
  { dx: -1, dy:  0 },
  { dx:  0, dy:  1 },
  { dx:  0, dy: -1 },
  { dx:  1, dy:  1 },
  { dx:  1, dy: -1 },
  { dx: -1, dy:  1 },
  { dx: -1, dy: -1 },
];

async function isTileWalkableForSnake(gridX: number, gridY: number): Promise<boolean> {
  const chunkX = Math.floor(gridX / CHUNK_SIZE);
  const chunkY = Math.floor(gridY / CHUNK_SIZE);
  const chunks = await getChunksByCoords([{ chunkX, chunkY }]);
  const terrainJson = chunks[0]?.terrainDataJson;
  if (!terrainJson) return false;
  const terrain: string[][] = JSON.parse(terrainJson);
  const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return (terrain[localY]?.[localX] ?? "") === "#";
}

// Returns [left-90°, right-90°] of the given direction
function getPerpendicularFacings(f: Dir): [Dir, Dir] {
  return [
    { dx: -f.dy, dy:  f.dx },   // 90° left
    { dx:  f.dy, dy: -f.dx },   // 90° right
  ];
}

// Pick the perpendicular direction whose 2-tile destination is closest (by Chebyshev) to a body segment.
// Falls back to random if both are equidistant or there are no segments.
function pickCoilTurn(
  head: { x: number; y: number },
  options: Dir[],
  segments: Array<{ x: number; y: number }>,
): Dir {
  if (segments.length === 0 || options.length === 0) {
    return options[Math.floor(Math.random() * options.length)] ?? { dx: 1, dy: 0 };
  }

  let best = options[0]!;
  let bestDist = Infinity;

  for (const opt of options) {
    const dest = { x: head.x + 2 * opt.dx, y: head.y + 2 * opt.dy };
    for (const seg of segments) {
      const d = chebyshevDistance(dest.x, dest.y, seg.x, seg.y);
      if (d < bestDist) {
        bestDist = d;
        best = opt;
      }
    }
  }

  return best;
}

// Return Math.sign direction from `from` toward `to` (clamped to 8-directional unit vector)
function directionToward(from: { x: number; y: number }, to: { x: number; y: number }): Dir {
  return {
    dx: Math.sign(to.x - from.x),
    dy: Math.sign(to.y - from.y),
  };
}

// Try all 8 unit directions for a valid 2-tile walkable path.
// If preferDir is given, sort directions so it's tried first.
async function findWalkableFacing(
  head: { x: number; y: number },
  preferDir?: Dir,
): Promise<Dir | null> {
  const dirs = preferDir
    ? [preferDir, ...ALL_DIRS.filter(d => d.dx !== preferDir.dx || d.dy !== preferDir.dy)]
    : [...ALL_DIRS];

  for (const d of dirs) {
    const intermOk = await isTileWalkableForSnake(head.x + d.dx, head.y + d.dy);
    const destOk   = await isTileWalkableForSnake(head.x + 2 * d.dx, head.y + 2 * d.dy);
    if (intermOk && destOk) return d;
  }
  return null;
}

// Instance-aware frog query: lair snakes query lair frogs; overworld snakes use 3×3 chunk area.
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

// Wraps createPendingAction with the initiative formula.
async function queueSnakeAction(
  predator: Predator,
  actionType: string,
  targetGridX: number,
  targetGridY: number,
  payload: Record<string, unknown>,
  stats: PredatorStats,
): Promise<void> {
  const speed         = stats.speed ?? 5;
  const d4            = Math.ceil(Math.random() * 4);
  const delay         = ((10 - speed) * 2) + d4;
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

// ─────────────────────────────────────────────
// MAIN AI ENTRY POINT
// ─────────────────────────────────────────────

export async function calculateSnakeIntent(predator: Predator): Promise<void> {
  const stats = (predator.statsJson ?? {}) as PredatorStats;
  const head  = { x: predator.gridX, y: predator.gridY };

  // ── 0. Starvation check ────────────────────────────────────────
  // Snakes that haven't eaten in >378 heartbeats (~63 min) despawn silently.
  // Exempt: snakes actively wrapping a frog (finish the constriction first).
  const currentHeartbeatForStarve = Math.floor(Date.now() / 10_000);
  const isStarved = currentHeartbeatForStarve - predator.lastMealTick > 378;
  if (isStarved && !stats.wrapping) {
    // Drop carried loot at the head tile before despawning. This path runs in the
    // non-batched entity-intent phase, so the writes are direct (no Exhale queue).
    for (const itemId of predator.lootItems ?? []) {
      await updateItem(itemId, {
        itemState:  "GROUND",
        gridX:      predator.gridX,
        gridY:      predator.gridY,
        ownerId:    null,
        instanceId: predator.instanceId ?? null,
      });
    }
    await deletePredator(predator.id);
    return;
  }

  // ── 1. Wrapping check ──────────────────────────────────────────
  if (stats.wrapping) {
    const alive  = await getAliveFrogs(predator);
    const target = alive.find(f => f.id === stats.wrapping!.targetFrogId);

    if (!target) {
      // Target frog is gone — clear the stuck flag and fall through to movement
      await updatePredator(predator.id, { statsJson: { ...stats, wrapping: null } });
      // Update local copy so movement phase doesn't see stale wrapping state
      (stats as Record<string, unknown>).wrapping = null;
    } else {
      await queueSnakeAction(predator, "STRIKE", target.gridX, target.gridY, { targetFrogId: target.id }, stats);
      return;
    }
  }

  // ── 2. Frog list ────────────────────────────────────────────────
  const alive = await getAliveFrogs(predator);

  // ── 3. Hunger check ─────────────────────────────────────────────
  const currentHeartbeat = Math.floor(Date.now() / 10_000);
  const isHungry = currentHeartbeat - predator.lastMealTick > 18;

  // ── 4. Strike check (hungry + frog within 3 tiles) ──────────────
  if (isHungry && alive.length > 0) {
    let closestFrog = alive[0]!;
    let closestDist = chebyshevDistance(head.x, head.y, closestFrog.gridX, closestFrog.gridY);
    for (const frog of alive.slice(1)) {
      const d = chebyshevDistance(head.x, head.y, frog.gridX, frog.gridY);
      if (d < closestDist) { closestFrog = frog; closestDist = d; }
    }
    if (closestDist <= 5) {
      await queueSnakeAction(predator, "STRIKE", closestFrog.gridX, closestFrog.gridY, { targetFrogId: closestFrog.id }, stats);
      return;
    }
  }

  // ── 5. Movement ─────────────────────────────────────────────────
  const segments = stats.segments ?? [];

  // Determine base direction: toward closest frog when hungry+frogs exist, else current facing
  let closestFrogForMovement: Frog | null = null;
  if (isHungry && alive.length > 0) {
    closestFrogForMovement = alive.reduce((best, f) =>
      chebyshevDistance(head.x, head.y, f.gridX, f.gridY) <
      chebyshevDistance(head.x, head.y, best.gridX, best.gridY) ? f : best
    );
  }

  let facing: Dir = stats.facing
    ?? (closestFrogForMovement ? directionToward(head, { x: closestFrogForMovement.gridX, y: closestFrogForMovement.gridY }) : null)
    ?? await findWalkableFacing(head)
    ?? { dx: 1, dy: 0 };

  // If hunting, bias the base facing toward the frog
  if (closestFrogForMovement) {
    facing = directionToward(head, { x: closestFrogForMovement.gridX, y: closestFrogForMovement.gridY });
  }

  // ── 50% coil turn ──────────────────────────────────────────────
  if (Math.random() < 0.5) {
    const perps = getPerpendicularFacings(facing);
    const walkablePerps: Dir[] = [];

    for (const p of perps) {
      const intermOk = await isTileWalkableForSnake(head.x + p.dx, head.y + p.dy);
      const destOk   = await isTileWalkableForSnake(head.x + 2 * p.dx, head.y + 2 * p.dy);
      if (intermOk && destOk) walkablePerps.push(p);
    }

    if (walkablePerps.length > 0) {
      facing = pickCoilTurn(head, walkablePerps, segments);
    }
    // else: no walkable perp, skip the turn and keep current facing
  }

  // ── Validate chosen path ────────────────────────────────────────
  const intermOk = await isTileWalkableForSnake(head.x + facing.dx, head.y + facing.dy);
  const destOk   = await isTileWalkableForSnake(head.x + 2 * facing.dx, head.y + 2 * facing.dy);

  if (!intermOk || !destOk) {
    // Chosen direction is blocked — try all 8 directions
    const preferDir = closestFrogForMovement
      ? directionToward(head, { x: closestFrogForMovement.gridX, y: closestFrogForMovement.gridY })
      : undefined;
    const fallback = await findWalkableFacing(head, preferDir);

    if (!fallback) {
      // Fully boxed in — idle this heartbeat, randomize facing for next cycle
      const randFacing = ALL_DIRS[Math.floor(Math.random() * ALL_DIRS.length)]!;
      await updatePredator(predator.id, { statsJson: { ...stats, facing: randFacing } });
      return;
    }
    facing = fallback;
  }

  // ── Queue SLITHER ────────────────────────────────────────────────
  const targetGridX = head.x + 2 * facing.dx;
  const targetGridY = head.y + 2 * facing.dy;
  await queueSnakeAction(predator, "SLITHER", targetGridX, targetGridY, {}, stats);
}
