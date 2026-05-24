import { getActivePredators } from "../db";
import { calculateSnakeIntent } from "./snake";
import { calculateGolemIntent } from "./golem";
import type { NotifyFn } from "../actions/_types";

// ─────────────────────────────────────────────
// ENTITY LIBRARY — Registry
// ─────────────────────────────────────────────
//
// processEntityIntents() is called at Tick 0 of each heartbeat cycle
// (on the "cycle_start" event emitted by heartbeat.ts).
//
// It pulls all active predators from the DB and routes each to the
// appropriate AI brain by enemyType. The AI brain calculates intent
// and queues a pending_action with a future resolveBucket — the
// action will then be picked up by processPredatorActions() inside
// the tick processor when its bucket arrives.
//
// To add a new entity type:
//   1. Create server/entities/<type>.ts with a calculateXIntent(predator) export.
//   2. Add an "else if" branch below for the new enemyTypeEnum value.

export async function processEntityIntents(_notify: NotifyFn): Promise<void> {
  const predators = await getActivePredators();

  for (const predator of predators) {
    if (predator.enemyType === "SNAKE") {
      await calculateSnakeIntent(predator);
    } else if (predator.enemyType === "GOLEM") {
      await calculateGolemIntent(predator);
    }
    // Future: FLY, TOAD, etc.
  }
}
