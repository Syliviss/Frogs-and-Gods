import FastNoiseLite from "fastnoise-lite";
import type { Biome } from "../../shared/game.schema";
import { BIOME_REGISTRY, getBiomeForChunk } from "./biomeMap";
import { isChunkSolid } from "./macroLayer";
import { resolveTile, scatterLilyPads } from "./tileResolver";

export const CHUNK_SIZE = 16;

export interface ChunkResult {
  grid:  string[][] | null;  // null for void chunks
  biome: Biome;
}

export function generateChunk(
  chunkX:    number,
  chunkY:    number,
  seed:      number,
  macroGrid: Uint8Array,
): ChunkResult {
  // Layer 0: macro gate — cull void chunks before any tile work
  if (!isChunkSolid(chunkX, chunkY, macroGrid)) {
    return { grid: null, biome: "void" };
  }

  // Layer 1: biome assignment
  const biomeName = getBiomeForChunk(chunkX, chunkY, seed);
  const biome     = BIOME_REGISTRY[biomeName];

  // Layer 2: noise sampler
  const noise = new FastNoiseLite(seed);
  noise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  noise.SetFrequency(biome.frequency);

  // Layer 3: tile resolution
  const grid: string[][] = [];
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const row: string[] = [];
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const worldX = chunkX * CHUNK_SIZE + lx;
      const worldY = chunkY * CHUNK_SIZE + ly;
      const raw        = noise.GetNoise(worldX, worldY);
      const normalized = (raw + 1) / 2;
      row.push(resolveTile(normalized, biome));
    }
    grid.push(row);
  }

  // Layer 3.5: lily pad scatter (chunk-level, density-weighted)
  scatterLilyPads(grid, chunkX, chunkY, seed);

  // POI layouts are detected and stamped by the world bake (see server/poi/worldgen.ts),
  // not here — generateChunk produces pure terrain.

  return { grid, biome: biomeName };
}
