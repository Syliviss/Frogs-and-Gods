import type { BiomeDef } from "./biomeMap";

// Returns the tile character for a single tile given its noise value.
// Lily pad "@" placement is handled as a chunk-level post-pass in scatterLilyPads().
export function resolveTile(
  noise:  number,
  biome:  BiomeDef,
): string {
  if (noise < biome.waterThreshold)  return "≈";
  if (noise < biome.shoreThreshold)  return "+";
  if (noise < biome.riverThreshold)  return "~";
  if (noise >= 0.85)                 return "^";
  return "#";
}

// --- Lily pad scatter (Layer 3.5) ---

type WeightedEntry = [count: number, weight: number];

// Weighted tables keyed by water tile density.
// Weights are relative integers; do not need to sum to any particular value.
const SPARSE: WeightedEntry[] = [[0, 8], [1, 1]];                    // 1–10% water
const LOW:    WeightedEntry[] = [[0, 2], [1, 6], [2, 2], [3, 1], [4, 1]]; // 11–30%
const MED:    WeightedEntry[] = [[0, 1], [1, 2], [2, 5], [3, 2], [4, 1]]; // 31–60%
const HIGH:   WeightedEntry[] = [[1, 1], [2, 2], [3, 5], [4, 2], [5, 1]]; // 61–100%

function makeRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function weightedSample(table: WeightedEntry[], rng: () => number): number {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [count, weight] of table) {
    r -= weight;
    if (r <= 0) return count;
  }
  return table[table.length - 1][0];
}

// Scatters "@" lily pad tiles into the already-generated chunk grid.
// Deterministic: same chunkX/chunkY/seed always produces the same placement.
// Must be called AFTER the base tile grid is built and BEFORE POI stamping.
export function scatterLilyPads(
  grid:   string[][],
  chunkX: number,
  chunkY: number,
  seed:   number,
): void {
  // Collect all deep-water positions
  const waterPos: [number, number][] = [];
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
      const t = grid[row][col];
      if (t === "≈" || t === "+" || t === "~") waterPos.push([row, col]);
    }
  }

  const totalTiles = grid.length * (grid[0]?.length ?? 0);
  if (totalTiles === 0 || waterPos.length === 0) return;

  const waterPct = waterPos.length / totalTiles;
  const rng = makeRNG((chunkX * 73856 + chunkY * 31337 + seed) | 0);

  // Select count from the appropriate weighted table
  let count: number;
  if (waterPct === 0) {
    count = 0;
  } else if (waterPct <= 0.10) {
    count = weightedSample(SPARSE, rng);
  } else if (waterPct <= 0.30) {
    count = weightedSample(LOW, rng);
  } else if (waterPct <= 0.60) {
    count = weightedSample(MED, rng);
  } else {
    count = weightedSample(HIGH, rng);
  }

  if (count === 0) return;

  // Fisher-Yates shuffle (in-place, seeded) then take first `count`
  for (let i = waterPos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [waterPos[i], waterPos[j]] = [waterPos[j], waterPos[i]];
  }

  const toPlace = Math.min(count, waterPos.length);
  for (let k = 0; k < toPlace; k++) {
    const [row, col] = waterPos[k];
    grid[row][col] = "@";
  }
}
