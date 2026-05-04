import "dotenv/config";
import { createWorldMapChunk, getChunksInBoundingBox } from "../server/db";
import { generateChunk, WORLD_SEED } from "../server/utils/worldGenerator";

const MIN_COORD = -4;
const MAX_COORD =  4;

async function main() {
  const total = (MAX_COORD - MIN_COORD + 1) ** 2;
  console.log(`[seedWorld] Seeding ${total} chunks (${MIN_COORD}..${MAX_COORD} on each axis)...`);

  const existing = await getChunksInBoundingBox(MIN_COORD, MAX_COORD, MIN_COORD, MAX_COORD);
  const existingKeys = new Set(existing.map((c) => `${c.chunkX}:${c.chunkY}`));
  console.log(`[seedWorld] ${existingKeys.size} chunk(s) already exist — skipping those.`);

  let created = 0;
  for (let cy = MIN_COORD; cy <= MAX_COORD; cy++) {
    for (let cx = MIN_COORD; cx <= MAX_COORD; cx++) {
      if (existingKeys.has(`${cx}:${cy}`)) continue;
      const terrainGrid = generateChunk(cx, cy, WORLD_SEED);
      await createWorldMapChunk({
        chunkX:          cx,
        chunkY:          cy,
        chunkSize:       16,
        biome:           "grassland",
        terrainDataJson: JSON.stringify(terrainGrid),
      });
      console.log(`[seedWorld] Created chunk (${cx}, ${cy})`);
      created++;
    }
  }

  console.log(`[seedWorld] Done. Created: ${created}, Skipped: ${existingKeys.size}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedWorld] Error:", err);
  process.exit(1);
});
