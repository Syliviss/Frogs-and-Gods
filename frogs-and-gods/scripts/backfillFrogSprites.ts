import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { isNull } from "drizzle-orm";
import { frogs } from "../drizzle/schema";
import { generateFrogPixelData } from "../server/assets/frogModels";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const client = postgres(url);
  const db = drizzle(client);

  const bullFrogSprite = generateFrogPixelData("BULL_FROG");

  const result = await db
    .update(frogs)
    .set({ modelJson: bullFrogSprite })
    .where(isNull(frogs.modelJson));

  console.log(`[backfillFrogSprites] Updated frogs with null model_json to BULL_FROG sprite.`);
  console.log(`[backfillFrogSprites] Done. New frogs will receive their correct species sprite at creation time.`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
