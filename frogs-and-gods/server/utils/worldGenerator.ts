import FastNoiseLite from "fastnoise-lite";

export const CHUNK_SIZE = 16;
export const WORLD_SEED = 42;

function tileChar(n: number, x: number, y: number): string {
  if (n < 0.1) return "≈"; // Deep Lake
  if (n < 0.3) return "+"; // Shore
  if (n < 0.4) return "~"; // River
  return (x + y) % 3 === 0 ? "@" : "#"; // Land / Lily Pad
}

export function generateChunk(
  chunkX: number,
  chunkY: number,
  globalSeed: number
): string[][] {
  const noise = new FastNoiseLite(globalSeed);
  noise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
  noise.SetFrequency(0.08);

  const grid: string[][] = [];
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row: string[] = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const worldX = chunkX * CHUNK_SIZE + x;
      const worldY = chunkY * CHUNK_SIZE + y;
      const raw = noise.GetNoise(worldX, worldY); // -1..1
      const normalized = (raw + 1) / 2;           // 0..1
      row.push(tileChar(normalized, x, y));
    }
    grid.push(row);
  }
  return grid;
}
