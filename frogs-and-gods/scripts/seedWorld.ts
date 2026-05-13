import "dotenv/config";
import { batchCreateWorldMapChunks } from "../server/db";
import { generateChunk, MACRO_GRID, WORLD_SEED, WORLD_GRID_SIZE, GRID_RADIUS } from "../server/worldgen/index";
import type { InsertWorldMapChunk } from "../drizzle/schema";

const MIN_COORD = -GRID_RADIUS;  // -157
const MAX_COORD =  GRID_RADIUS;  //  157
const BATCH_SIZE = 500;

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const total    = WORLD_GRID_SIZE * WORLD_GRID_SIZE;  // 99,225

  console.log(`[seedWorld] ${isDryRun ? "DRY RUN — " : ""}Seeding ${total} chunks (${MIN_COORD}..${MAX_COORD} on each axis)`);
  console.log(`[seedWorld] Macro grid pre-computed (Wolfram CA + radial mask)`);

  let batch: InsertWorldMapChunk[] = [];
  let processed  = 0;
  let voidCount  = 0;
  let solidCount = 0;

  for (let cy = MIN_COORD; cy <= MAX_COORD; cy++) {
    for (let cx = MIN_COORD; cx <= MAX_COORD; cx++) {
      const { grid, biome } = generateChunk(cx, cy, WORLD_SEED, MACRO_GRID);

      batch.push({
        chunkX:          cx,
        chunkY:          cy,
        chunkSize:       16,
        biome,
        terrainDataJson: grid ? JSON.stringify(grid) : null,
      });

      if (biome === "void") voidCount++;
      else solidCount++;
      processed++;

      if (batch.length >= BATCH_SIZE) {
        if (!isDryRun) await batchCreateWorldMapChunks(batch);
        batch = [];
        if (processed % 5000 === 0) {
          const pct = ((processed / total) * 100).toFixed(1);
          console.log(`[seedWorld] ${processed}/${total} (${pct}%) — solid: ${solidCount}, void: ${voidCount}`);
        }
      }
    }
  }

  if (batch.length > 0 && !isDryRun) {
    await batchCreateWorldMapChunks(batch);
  }

  console.log(`[seedWorld] Done.`);
  console.log(`  Total:  ${processed}`);
  console.log(`  Solid:  ${solidCount}`);
  console.log(`  Void:   ${voidCount}`);
  if (isDryRun) console.log(`  (dry run — nothing written to DB)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedWorld] Error:", err);
  process.exit(1);
});
