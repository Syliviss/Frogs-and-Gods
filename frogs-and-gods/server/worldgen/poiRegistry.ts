import type { PoiDef } from "./poiTypes";

export const CHUNK_SIZE = 16;

export const POI_REGISTRY: PoiDef[] = [
  // Add POIs here. anchorX/anchorY are absolute world tile coordinates.
  // tiles[] entries are offsets from the anchor; char overwrites the biome tile.
];

// Stamps all POIs whose tile footprints overlap the given chunk into grid (in-place).
// grid[y][x], 0-indexed local coordinates within the chunk.
export function stampPois(
  chunkX: number,
  chunkY: number,
  grid:   string[][],
): void {
  const minTileX = chunkX * CHUNK_SIZE;
  const minTileY = chunkY * CHUNK_SIZE;

  for (const poi of POI_REGISTRY) {
    if (!poi.tiles) continue;
    for (const { dx, dy, char } of poi.tiles) {
      const tileX = poi.anchorX + dx;
      const tileY = poi.anchorY + dy;
      const localX = tileX - minTileX;
      const localY = tileY - minTileY;
      if (localX < 0 || localX >= CHUNK_SIZE || localY < 0 || localY >= CHUNK_SIZE) continue;
      grid[localY][localX] = char;
    }
  }
}
