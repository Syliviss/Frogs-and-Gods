import type { ActionContext, ActionHandler, NotifyFn } from "./_types";
import { getFrogById, hasFrogActedThisHeartbeat, createPendingAction } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { stepHandler } from "./step";
import { hopHandler } from "./hop";
import { equipHandler } from "./equip";
import { unequipHandler } from "./unequip";
import { throwHandler } from "./throw";
import { storeHandler } from "./store";
import { giveHandler } from "./give";
import { swingHandler } from "./swing";
import { createItemHandler } from "./create_item";
import { spawnItemHandler } from "./spawn_item";
import { spawnPredatorHandler } from "./spawn";
import { killPredatorHandler } from "./kill_predator";
import { slitherHandler } from "./slither";
import { strikeHandler } from "./strike";
import { wrapHandler } from "./wrap";
import type { GodActionHandler } from "./god_types";
import type { PredatorActionHandler } from "./_predator_types";
export { GOD_ACTION_TYPES } from "./_god_action_types";
export { PREDATOR_ACTION_TYPES } from "./_predator_action_types";

// ─────────────────────────────────────────────
// ACTION REGISTRY
// To add a new action: import its handler and add it here.
// See ACTIONS.md for the full contract and documentation.
// ─────────────────────────────────────────────

const ACTION_REGISTRY: Record<string, ActionHandler> = {
  STEP:       stepHandler,
  HOP:        hopHandler,
  EQUIP:      equipHandler,
  UNEQUIP:    unequipHandler,
  THROW:      throwHandler,
  STORE_ITEM: storeHandler,
  GIVE:       giveHandler,
  SWING:      swingHandler,
};

export const GOD_ACTION_REGISTRY: Record<string, GodActionHandler> = {
  CREATE_ITEM:    createItemHandler,
  SPAWN_ITEM:     spawnItemHandler,
  SPAWN_PREDATOR: spawnPredatorHandler,
  KILL_PREDATOR:  killPredatorHandler,
};

export const PREDATOR_ACTION_REGISTRY: Record<string, PredatorActionHandler> = {
  SLITHER: slitherHandler,
  STRIKE:  strikeHandler,
  WRAP:    wrapHandler,
};

export { ACTION_REGISTRY };

// ─────────────────────────────────────────────
// MAIN DISPATCHER
// ─────────────────────────────────────────────

export async function runAction(
  ctx: ActionContext,
  notify: NotifyFn,
): Promise<{ ok: boolean; fumble?: boolean; message?: string }> {
  const handler = ACTION_REGISTRY[ctx.actionType];
  if (!handler) {
    return { ok: false, message: `Unknown action type: ${ctx.actionType}` };
  }

  // Gate 1: frog must already have acted check (heartbeat deduplication)
  const alreadyActed = await hasFrogActedThisHeartbeat(ctx.frogId);
  if (alreadyActed) {
    return { ok: false, message: "Frog has already acted this heartbeat." };
  }

  // Gate 2: resolve the frog row so handlers don't need to re-fetch
  const frog = await getFrogById(ctx.frogId);
  if (!frog) return { ok: false, message: "Frog not found." };
  if (frog.isDead) return { ok: false, message: "Dead frogs cannot act." };
  ctx.frog = frog;

  // Gate 3: validate
  const validation = await handler.validate(ctx);

  if (!validation.ok) {
    if (validation.code === "FUMBLE") {
      // Fumble: consume the turn, broadcast, block further actions this tick
      const msg = validation.message ?? `${frog.name} fumbled!`;
      pushActionLog({
        text:     msg,
        x:        frog.gridX,
        y:        frog.gridY,
        chunk_id: `${Math.floor(frog.gridX / 16)}:${Math.floor(frog.gridY / 16)}`,
        category: "movement",
      });
      // Insert sentinel resolved action so hasFrogActedThisHeartbeat blocks the rest of this tick
      await createPendingAction({
        actorId:       frog.id,
        actionType:    "FUMBLE",
        resolveBucket: Math.floor(Date.now() / 500),
        status:        "resolved",
        resolvedAt:    new Date(),
      });
      notify(frog.ownerId!, { type: "FUMBLE", message: msg });
      return { ok: false, fumble: true, message: msg };
    }
    // Silent reject — turn not consumed
    return { ok: false, message: validation.message };
  }

  // Execute
  const result = await handler.execute(ctx);

  // Broadcast
  await handler.broadcast(ctx, result, notify);

  return { ok: result.success };
}
