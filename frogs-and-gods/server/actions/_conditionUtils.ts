import type { Frog, PredatorStats } from "../../drizzle/schema";
import { getFrogById, getPredatorById, updatePredator, updateFrog } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { CHUNK_SIZE } from "../utils/worldGenerator";

/**
 * Condition gate — call at the top of any frog action's validate() phase.
 *
 * Current conditions handled:
 *   WRAPPED — frog is constricted by a snake.
 *     - Pass: Math.max(str, dex) >= 15 → frog breaks free this turn; action proceeds.
 *     - Fail: frog is still held → return FUMBLE (turn consumed struggling).
 *
 * To add a future condition: insert another branch before the final `return { ok: true }`.
 *
 * @returns { ok: true }  when the frog is free to act (either unaffected or just escaped).
 * @returns { ok: false } when the frog is held — caller should return FUMBLE.
 */
export async function rollConditionCheck(frog: Frog): Promise<{ ok: boolean }> {
  if (frog.statsJson.wrappedBy) {
    const escapeRoll = Math.max(frog.statsJson.str, frog.statsJson.dex);

    if (escapeRoll >= 15) {
      const predator = await getPredatorById(frog.statsJson.wrappedBy);
      if (predator) {
        const ps = (predator.statsJson ?? {}) as PredatorStats;
        await updatePredator(predator.id, { statsJson: { ...ps, wrapping: null } });
      }
      await updateFrog(frog.id, { statsJson: { ...frog.statsJson, wrappedBy: null } });
      pushActionLog({
        text:     `${frog.name} wrenches free from the snake's coils!`,
        x:        frog.gridX,
        y:        frog.gridY,
        chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });
      return { ok: true };
    }

    return { ok: false };
  }

  return { ok: true };
}
