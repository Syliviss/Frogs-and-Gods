import type { SimulatedState } from "../engine/types";
import { getTerrainAt } from "./_utils";
import { isChunkSolid, MACRO_GRID } from "../worldgen/macroLayer";

// ─────────────────────────────────────────────
// SPAWN TILE UTILITIES
// Used by CREATE_FROG to find appropriate spawn positions near lairs.
// ─────────────��─────────────────────────��─────

const WORLD_RADIUS_CHUNKS = 157;
const CHUNK_SIZE = 16;

/**
 * Search outward from (entranceX, entranceY) for the closest "≈" (deep water) tile.
 * From that water tile, find any loaded tile within spawnRadius.
 * Falls back to the entrance tile itself if no water is found within searchRadius.
 */
export function findSpawnTileNearLair(
  state: SimulatedState,
  entranceX: number,
  entranceY: number,
  searchRadius = 15,
  spawnRadius = 5,
): { gridX: number; gridY: number } {
  // Phase 1: find closest water tile by expanding Chebyshev rings
  let waterX = entranceX;
  let waterY = entranceY;
  let foundWater = false;

  outer:
  for (let r = 0; r <= searchRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const tx = entranceX + dx;
        const ty = entranceY + dy;
        if (getTerrainAt(state, tx, ty) === "≈") {
          waterX = tx;
          waterY = ty;
          foundWater = true;
          break outer;
        }
      }
    }
  }

  // Phase 2: find any loaded tile within spawnRadius of the water tile
  // (skipping the water tile itself so frogs don't spawn in deep water until movement rework)
  for (let r = 1; r <= spawnRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = waterX + dx;
        const ty = waterY + dy;
        const chunkX = Math.floor(tx / CHUNK_SIZE);
        const chunkY = Math.floor(ty / CHUNK_SIZE);
        if (state.chunks.has(`${chunkX},${chunkY}`)) {
          return { gridX: tx, gridY: ty };
        }
      }
    }
  }

  // Fallback: use the lair entrance tile itself (or water tile if found)
  return foundWater ? { gridX: waterX, gridY: waterY } : { gridX: entranceX, gridY: entranceY };
}

/**
 * Returns the center tile of a solid (non-void) chunk on the outermost edge ring.
 * Uses the userId as a seed so the position is deterministic per player.
 * Scans outward along the chosen edge until a solid chunk is found, so the
 * returned tile is always inside a chunk where terrain data will exist.
 */
export function pickRandomMapEdgeTile(userId: number): { gridX: number; gridY: number } {
  const seed = (userId * 2654435761) >>> 0;
  const side = seed % 4; // 0=N, 1=S, 2=E, 3=W

  // Initial varying chunk coordinate: -WORLD_RADIUS_CHUNKS..+WORLD_RADIUS_CHUNKS
  const initVary = ((seed >> 2) % (WORLD_RADIUS_CHUNKS * 2 + 1)) - WORLD_RADIUS_CHUNKS;

  // N/S: chunkY is fixed, chunkX varies. E/W: chunkX is fixed, chunkY varies.
  const isNS = side < 2;
  const fixedCoord = (side === 1 || side === 2) ? WORLD_RADIUS_CHUNKS : -WORLD_RADIUS_CHUNKS;
  // N(0)→fixedY=-157  S(1)→fixedY=+157  E(2)→fixedX=+157  W(3)→fixedX=-157

  // Scan outward from initVary along the same edge to find the nearest solid chunk.
  let solidVary = initVary;
  outer:
  for (let r = 0; r <= WORLD_RADIUS_CHUNKS * 2; r++) {
    const candidates = r === 0 ? [initVary] : [initVary + r, initVary - r];
    for (const v of candidates) {
      if (v < -WORLD_RADIUS_CHUNKS || v > WORLD_RADIUS_CHUNKS) continue;
      const cx = isNS ? v : fixedCoord;
      const cy = isNS ? fixedCoord : v;
      if (isChunkSolid(cx, cy, MACRO_GRID)) {
        solidVary = v;
        break outer;
      }
    }
  }

  const chunkX = isNS ? solidVary : fixedCoord;
  const chunkY = isNS ? fixedCoord : solidVary;
  return {
    gridX: chunkX * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2),
    gridY: chunkY * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2),
  };
}

/**
 * Derives a frog's max breath from their dex stat.
 * Phase 1 (dex 1–20): +1 per 2 dex points (max 10 at dex 20).
 * Phase 2 (dex 21+): +1 at thresholds 25, 31, 38, 46, 55... (intervals 5, 6, 7, 8, 9...).
 */
export function calcMaxBreath(dex: number): number {
  const phase1 = Math.min(Math.floor(dex / 2), 10);
  if (dex <= 20) return phase1;
  let phase2 = 0;
  let threshold = 25;
  let nextInterval = 6;
  while (dex >= threshold) {
    phase2++;
    threshold += nextInterval;
    nextInterval++;
  }
  return phase1 + phase2;
}
