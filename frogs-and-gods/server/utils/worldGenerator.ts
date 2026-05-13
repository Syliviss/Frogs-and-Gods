// Backward-compat shim — all logic lives in server/worldgen/.
// All existing imports of CHUNK_SIZE, WORLD_SEED, and generateChunk continue to work.
import { generateChunk as _generate, MACRO_GRID } from "../worldgen/index";

export { CHUNK_SIZE, WORLD_SEED } from "../worldgen/index";

// 3-arg legacy signature used by admin.ts spawnChunk and any other direct callers.
// Delegates to the 4-arg pipeline using the pre-computed MACRO_GRID singleton.
export function generateChunk(chunkX: number, chunkY: number, seed: number): string[][] {
  const result = _generate(chunkX, chunkY, seed, MACRO_GRID);
  return result.grid ?? [];
}
