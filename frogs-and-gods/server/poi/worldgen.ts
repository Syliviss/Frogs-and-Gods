import type { Biome } from "../../shared/game.schema";
import { CHUNK_SIZE } from "../worldgen/generator";
import { POI_TYPE_REGISTRY } from "./registry";
import type { RequiredOffset } from "./types";

// A POI detected during the world bake, before it becomes a points_of_interest row.
export interface DetectedPoi {
  poiType: string;
  gridX:   number;
  gridY:   number;
  chunkX:  number;
  chunkY:  number;
}

// Deterministic 0..1 roll for one (tile, poiType) pair — same inputs always agree.
function poiRoll(worldX: number, worldY: number, typeIndex: number, seed: number): number {
  let s = ((worldX * 73856093) ^ (worldY * 19349663) ^ ((typeIndex + 1) * 83492791) ^ seed) | 0;
  s = (Math.imul(1664525, s) + 1013904223) | 0;
  return (s >>> 0) / 4294967296;
}

// True if any of the 8 in-chunk neighbors of (lx,ly) has a char in `wantedChars`.
// Within-chunk only: neighbors outside the grid are skipped (cross-chunk neighbors
// are not consulted). Density tuning absorbs the resulting edge approximation.
function hasNeighborInGrid(grid: string[][], lx: number, ly: number, wantedChars: string[]): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const row = grid[ly + dy];
      if (!row) continue;
      const c = row[lx + dx];
      if (c !== undefined && wantedChars.includes(c)) return true;
    }
  }
  return false;
}

// True only when EVERY listed offset's tile char is in its `chars` set. Within-chunk
// only: an offset that falls outside the grid is a fail (treated as ineligible).
function allOffsetsValid(
  grid: string[][],
  lx: number,
  ly: number,
  offsets: RequiredOffset[],
): boolean {
  for (const { dx, dy, chars } of offsets) {
    const row = grid[ly + dy];
    if (!row) return false;
    const c = row[lx + dx];
    if (c === undefined || !chars.includes(c)) return false;
  }
  return true;
}

// Scans a generated chunk grid and returns the POIs that anchor inside it.
// Deterministic: the same chunk + seed always yields the same POIs.
export function detectPois(
  chunkX: number,
  chunkY: number,
  grid:   string[][],
  biome:  Biome,
  seed:   number,
): DetectedPoi[] {
  const found: DetectedPoi[] = [];
  const defs = Object.values(POI_TYPE_REGISTRY);

  for (let ly = 0; ly < grid.length; ly++) {
    const row = grid[ly];
    if (!row) continue;
    for (let lx = 0; lx < row.length; lx++) {
      const char   = row[lx];
      const worldX = chunkX * CHUNK_SIZE + lx;
      const worldY = chunkY * CHUNK_SIZE + ly;

      for (let ti = 0; ti < defs.length; ti++) {
        const def = defs[ti]!;
        if (def.eligibleBiomes && !def.eligibleBiomes.includes(biome)) continue;
        if (!def.eligibleTiles.includes(char))                          continue;
        if (def.borderingTiles && !hasNeighborInGrid(grid, lx, ly, def.borderingTiles)) continue;
        if (def.requiredOffsets && !allOffsetsValid(grid, lx, ly, def.requiredOffsets)) continue;
        if (poiRoll(worldX, worldY, ti, seed) < def.density) {
          found.push({ poiType: def.type, gridX: worldX, gridY: worldY, chunkX, chunkY });
          break; // one POI per tile — first matching type wins
        }
      }
    }
  }
  return found;
}

// Stamps the layouts of the given POIs into a chunk grid (in-place). Layout tiles
// outside this chunk are skipped, so a POI whose footprint straddles chunk borders
// stamps correctly across every chunk it touches.
export function stampPoiLayouts(
  chunkX: number,
  chunkY: number,
  grid:   string[][],
  pois:   DetectedPoi[],
): void {
  const minTileX = chunkX * CHUNK_SIZE;
  const minTileY = chunkY * CHUNK_SIZE;

  for (const poi of pois) {
    const def = POI_TYPE_REGISTRY[poi.poiType];
    if (!def) continue;
    for (const { dx, dy, char } of def.layout) {
      const localX = poi.gridX + dx - minTileX;
      const localY = poi.gridY + dy - minTileY;
      if (localX < 0 || localX >= CHUNK_SIZE || localY < 0 || localY >= CHUNK_SIZE) continue;
      const r = grid[localY];
      if (r) r[localX] = char;
    }
  }
}
