import "dotenv/config";
import { batchCreateWorldMapChunks, batchCreatePois } from "../server/db";
import {
  generateChunk, MACRO_GRID, WORLD_SEED, WORLD_GRID_SIZE, GRID_RADIUS, CHUNK_SIZE,
} from "../server/worldgen/index";
import { detectPois, stampPoiLayouts, type DetectedPoi } from "../server/poi/worldgen";
import { POI_TYPE_REGISTRY } from "../server/poi/registry";
import type { InsertWorldMapChunk, InsertPointOfInterest } from "../drizzle/schema";

const MIN_COORD = -GRID_RADIUS;  // -157
const MAX_COORD =  GRID_RADIUS;  //  157
const BATCH_SIZE = 500;

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const total    = WORLD_GRID_SIZE * WORLD_GRID_SIZE;  // 99,225

  console.log(`[seedWorld] ${isDryRun ? "DRY RUN — " : ""}Seeding ${total} chunks (${MIN_COORD}..${MAX_COORD} on each axis)`);
  console.log(`[seedWorld] Macro grid pre-computed (Wolfram CA + radial mask)`);

  // ── Pass 1: detect POIs across every solid chunk ──────────────────────────
  const detectedPois: DetectedPoi[] = [];
  for (let cy = MIN_COORD; cy <= MAX_COORD; cy++) {
    for (let cx = MIN_COORD; cx <= MAX_COORD; cx++) {
      const { grid, biome } = generateChunk(cx, cy, WORLD_SEED, MACRO_GRID);
      if (grid) detectedPois.push(...detectPois(cx, cy, grid, biome, WORLD_SEED));
    }
  }
  console.log(`[seedWorld] Pass 1 complete — detected ${detectedPois.length} POIs`);

  // Index POIs by every chunk their layout footprint touches (handles cross-chunk layouts).
  const poisByChunk = new Map<string, DetectedPoi[]>();
  for (const poi of detectedPois) {
    const def = POI_TYPE_REGISTRY[poi.poiType];
    if (!def) continue;
    const touched = new Set<string>();
    for (const { dx, dy } of def.layout) {
      const tcx = Math.floor((poi.gridX + dx) / CHUNK_SIZE);
      const tcy = Math.floor((poi.gridY + dy) / CHUNK_SIZE);
      touched.add(`${tcx},${tcy}`);
    }
    for (const key of touched) {
      const list = poisByChunk.get(key);
      if (list) list.push(poi);
      else poisByChunk.set(key, [poi]);
    }
  }

  // ── Pass 2: regenerate each chunk, stamp POI layouts, persist ─────────────
  let batch: InsertWorldMapChunk[] = [];
  let processed  = 0;
  let voidCount  = 0;
  let solidCount = 0;

  for (let cy = MIN_COORD; cy <= MAX_COORD; cy++) {
    for (let cx = MIN_COORD; cx <= MAX_COORD; cx++) {
      const { grid, biome } = generateChunk(cx, cy, WORLD_SEED, MACRO_GRID);

      if (grid) {
        const poisForChunk = poisByChunk.get(`${cx},${cy}`);
        if (poisForChunk) stampPoiLayouts(cx, cy, grid, poisForChunk);
      }

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

  // ── Pass 3: persist POI rows ──────────────────────────────────────────────
  if (!isDryRun) {
    const poiRows: InsertPointOfInterest[] = detectedPois.map((p) => ({
      poiType: p.poiType,
      gridX:   p.gridX,
      gridY:   p.gridY,
      chunkX:  p.chunkX,
      chunkY:  p.chunkY,
    }));
    for (let i = 0; i < poiRows.length; i += BATCH_SIZE) {
      await batchCreatePois(poiRows.slice(i, i + BATCH_SIZE));
    }
  }

  const poisByType = new Map<string, number>();
  for (const p of detectedPois) poisByType.set(p.poiType, (poisByType.get(p.poiType) ?? 0) + 1);

  console.log(`[seedWorld] Done.`);
  console.log(`  Total:  ${processed}`);
  console.log(`  Solid:  ${solidCount}`);
  console.log(`  Void:   ${voidCount}`);
  console.log(`  POIs:   ${detectedPois.length}`);
  for (const [type, count] of [...poisByType.entries()].sort()) {
    console.log(`    ${type}: ${count}`);
  }
  if (isDryRun) console.log(`  (dry run — nothing written to DB)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seedWorld] Error:", err);
  process.exit(1);
});
