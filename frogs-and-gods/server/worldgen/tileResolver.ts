import type { BiomeDef } from "./biomeMap";

// Returns the tile character for a single tile given its noise value and world position.
// "%" lily pads appear ~2 per chunk in deep water via a deterministic hash.
export function resolveTile(
  noise:   number,
  worldX:  number,
  worldY:  number,
  seed:    number,
  biome:   BiomeDef,
): string {
  if (noise < biome.waterThreshold) {
    // Deterministic lily pad scatter: ~2 hits per 256-tile chunk.
    // Double-mod handles JS negative modulo for negative world coords.
    const h = ((worldX * 73856 + worldY * 31337 + seed) % 256 + 256) % 256;
    return h < 2 ? "%" : "≈";
  }
  if (noise < biome.shoreThreshold) return "+";
  if (noise < biome.riverThreshold) return "~";
  return "#";
}
