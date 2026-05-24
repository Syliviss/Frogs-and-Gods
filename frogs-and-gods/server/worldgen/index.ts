// Public API for the worldgen module.
// Consumed directly by seedWorld.ts and the admin router.
// The 3-arg shim in server/utils/worldGenerator.ts re-exports from here
// so all existing call-sites continue to compile without changes.

export { CHUNK_SIZE, generateChunk } from "./generator";
export type { ChunkResult }          from "./generator";
export { MACRO_GRID, WORLD_GRID_SIZE, GRID_RADIUS, WOLFRAM_RULE } from "./macroLayer";
export { BIOME_REGISTRY }            from "./biomeMap";
export type { BiomeDef }             from "./biomeMap";

export const WORLD_SEED = 42;
