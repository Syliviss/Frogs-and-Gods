import "dotenv/config";
import { createItem, createWorldMapChunk } from "../db";

async function main() {
  console.log("[seed] Seeding world map chunk and 1-of-1 item...");

  const chunk = await createWorldMapChunk({
    chunkX: 0,
    chunkY: 0,
    chunkSize: 16,
    biome: "grassland",
  });
  console.log(`[seed] Chunk created: id=${chunk.id} (${chunk.chunkX},${chunk.chunkY}) biome=${chunk.biome}`);

  const itemId = crypto.randomUUID();
  const item = await createItem({
    itemId,
    name: "The Sacred Lily Pad",
    rarityTier: 12,
    statsJson: {
      attackBonus: 50,
      defenseBonus: 40,
      hpBonus: 200,
      actionType: "ACTION_RIBBIT_OF_DOOM",
    },
    ownerType: "world_drop",
    ownerId: undefined,
    gridX: 0,
    gridY: 0,
  });
  console.log(`[seed] Item created: ${item.itemId} — "${item.name}" (Tier ${item.rarityTier})`);

  console.log("[seed] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Error:", err);
  process.exit(1);
});
