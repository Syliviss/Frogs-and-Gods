import FastNoiseLite from "fastnoise-lite";
import type { Biome } from "../../shared/game.schema";

export interface BiomeDef {
  name:            Biome;
  frequency:       number;
  waterThreshold:  number;
  shoreThreshold:  number;
  riverThreshold:  number;
}

export const BIOME_REGISTRY: Record<Biome, BiomeDef> = {
  grassland: { name: "grassland", frequency: 0.08, waterThreshold: 0.10, shoreThreshold: 0.30, riverThreshold: 0.40 },
  swamp:     { name: "swamp",     frequency: 0.06, waterThreshold: 0.30, shoreThreshold: 0.50, riverThreshold: 0.60 },
  forest:    { name: "forest",    frequency: 0.10, waterThreshold: 0.05, shoreThreshold: 0.20, riverThreshold: 0.30 },
  desert:    { name: "desert",    frequency: 0.12, waterThreshold: 0.02, shoreThreshold: 0.08, riverThreshold: 0.12 },
  mountain:  { name: "mountain",  frequency: 0.07, waterThreshold: 0.10, shoreThreshold: 0.20, riverThreshold: 0.50 },
  void:      { name: "void",      frequency: 0,    waterThreshold: 0,    shoreThreshold: 0,    riverThreshold: 0    },
};

const BIOME_NOISE_FREQUENCY = 0.015;

export function getBiomeForChunk(cx: number, cy: number, seed: number): Biome {
  const noise = new FastNoiseLite(seed + 9999);
  noise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  noise.SetFrequency(BIOME_NOISE_FREQUENCY);
  const n = (noise.GetNoise(cx, cy) + 1) / 2;

  if (n < 0.90) return "swamp";
  if (n < 0.96) return "mountain";
  if (n < 0.98) return "grassland";
  if (n < 0.99) return "forest";
  return "desert";
}
