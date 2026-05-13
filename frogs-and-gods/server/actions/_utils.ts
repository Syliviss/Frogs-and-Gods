import type { Frog, PredatorStats } from "../../drizzle/schema";
import type { TileChar } from "../../shared/game.schema";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { ValidationResult } from "./_types";
import { pushActionLog } from "../engine/actionLog";

// ─────────────────────────────────────────────
// SPATIAL UTILITIES
// ─────────────────────────────────────────────

export function getTerrainAt(state: SimulatedState, gridX: number, gridY: number): TileChar {
  const chunkX = Math.floor(gridX / CHUNK_SIZE);
  const chunkY = Math.floor(gridY / CHUNK_SIZE);
  const chunk = state.chunks.get(`${chunkX},${chunkY}`);
  if (!chunk || !chunk.terrainDataJson) return "#" as TileChar;
  
  const terrain: string[][] = JSON.parse(chunk.terrainDataJson);
  const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return (terrain[localY]?.[localX] ?? "#") as TileChar;
}

export function getEntitiesAt(state: SimulatedState, gridX: number, gridY: number) {
  return {
    frogs: state.getFrogsAt(gridX, gridY),
    predators: state.getPredatorsAt(gridX, gridY),
    items: state.getItemsAt(gridX, gridY),
  };
}

// ─────────────────────────────────────────────
// COMBAT & STATS UTILITIES
// ─────────────────────────────────────────────

export function applyDamage(
  state: SimulatedState,
  queue: UpdateInstruction[],
  targetType: "FROG" | "PREDATOR",
  id: number,
  amount: number
) {
  if (targetType === "FROG") {
    const frog = state.getFrog(id);
    if (!frog || frog.isDead) return;
    const newHp = Math.max(0, frog.currentHp - amount);
    const isDead = newHp === 0;
    state.updateFrog(id, { currentHp: newHp, isDead });
    queue.push({ type: "FROG_UPDATE", id, changes: { currentHp: newHp, isDead } });
    
    if (isDead) {
      queue.push({
        type: "WORLD_LOG_INSERT",
        data: {
          frogId:    frog.id,
          eventType: "FROG_DEATH",
          payload:   JSON.stringify({ message: `${frog.name} has died.` }),
          chunkX:    Math.floor(frog.gridX / 16),
          chunkY:    Math.floor(frog.gridY / 16),
        }
      });
    }
  } else {
    const predator = state.getPredator(id);
    if (!predator || predator.currentHp <= 0) return;
    const newHp = Math.max(0, predator.currentHp - amount);
    if (newHp === 0) {
      state.predators.delete(id);
      queue.push({ type: "PREDATOR_DELETE", id });
    } else {
      state.updatePredator(id, { currentHp: newHp });
      queue.push({ type: "PREDATOR_UPDATE", id, changes: { currentHp: newHp } });
    }
  }
}

/**
 * Condition gate — call at the top of any frog action's validate() phase.
 *
 * Checks all active conditions on the frog in priority order. If the frog is
 * free to act, returns { ok: true }. If a condition blocks the action, returns
 * a FUMBLE ValidationResult. If a condition is cleared (e.g. escape from wrap),
 * the appropriate UpdateInstructions are pushed to `out` so the clear is written
 * to the DB atomically in the next Exhale.
 *
 * Current conditions handled:
 *   WRAPPED — frog is constricted by a snake.
 *     - Pass (escape): Math.max(str, dex) >= 15 → UpdateInstructions clear both
 *       frog.statsJson.wrappedBy and predator.statsJson.wrapping; action proceeds.
 *     - Fail (held):   frog is still held → return FUMBLE (turn consumed struggling).
 *
 * To add a future condition: insert a new branch before the final `return { ok: true }`.
 *
 * @param frog  - The acting frog (from SimulatedState, already loaded).
 * @param state - The current SimulatedState snapshot.
 * @param out   - The UpdateInstruction queue for this tick; push clears here.
 * @returns ValidationResult — { ok: true } to proceed, FUMBLE to block.
 */
export function rollConditionCheck(
  frog: Frog,
  state: SimulatedState,
  out: UpdateInstruction[]
): ValidationResult {
  // ── WRAPPED condition ──
  if (frog.statsJson?.wrappedBy) {
    const escapeRoll = Math.max(frog.statsJson.str, frog.statsJson.dex);

    if (escapeRoll >= 15) {
      // Frog breaks free — clear both sides atomically via UpdateInstructions
      const frogChanges = { statsJson: { ...frog.statsJson, wrappedBy: null } };
      state.updateFrog(frog.id, frogChanges);
      out.push({ type: "FROG_UPDATE", id: frog.id, changes: frogChanges });

      const predator = state.getPredator(frog.statsJson.wrappedBy);
      if (predator) {
        const ps = (predator.statsJson ?? {}) as PredatorStats;
        const predChanges = { statsJson: { ...ps, wrapping: null } };
        state.updatePredator(predator.id, predChanges);
        out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: predChanges });
      }

      pushActionLog({
        text:     `${frog.name} wrenches free from the snake's coils!`,
        x:        frog.gridX,
        y:        frog.gridY,
        chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });

      return { ok: true };
    }

    // Held — turn consumed struggling
    return { ok: false, code: "FUMBLE", message: `${frog.name} struggles against the snake's coils but cannot break free!` };
  }

  // ── Add future conditions here ──

  return { ok: true };
}

// ─────────────────────────────────────────────
// ITEM & FUMBLE UTILITIES
// ─────────────────────────────────────────────

export function checkItemFumble(
  frogId: number,
  actionType: string,
  state: SimulatedState
): ValidationResult | null {
  // Find items owned by frog that are INVENTORY or EQUIPPED
  const frogItems = Array.from(state.items.values()).filter(i => i.ownerId === frogId);
  for (const item of frogItems) {
    const blocked = item.statsJson?.blockedActions ?? [];
    if (blocked.includes(actionType)) {
      return { ok: false, code: "FUMBLE", message: `Action blocked by ${item.name}!` };
    }
  }
  return null;
}
