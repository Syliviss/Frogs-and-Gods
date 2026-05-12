import type { Frog, Predator, Item } from "../../drizzle/schema";
import type { TileChar } from "../../shared/game.schema";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { ValidationResult } from "./_types";

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
          frogId: frog.id,
          frogName: frog.name,
          eventType: "FROG_DEATH",
          message: `${frog.name} has died.`,
          chunkX: Math.floor(frog.gridX / 16),
          chunkY: Math.floor(frog.gridY / 16),
          timestamp: Date.now(),
        }
      });
    }
  } else {
    const predator = state.getPredator(id);
    if (!predator || predator.currentHp <= 0) return;
    const newHp = Math.max(0, predator.currentHp - amount);
    state.updatePredator(id, { currentHp: newHp });
    queue.push({ type: "PREDATOR_UPDATE", id, changes: { currentHp: newHp } });
  }
}

export function rollConditionCheck(frog: Frog): ValidationResult {
  // If frog is wrapped, etc.
  if (frog.statsJson?.wrappedBy) {
    return { ok: false, code: "FUMBLE", message: `${frog.name} is held and cannot move!` };
  }
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
