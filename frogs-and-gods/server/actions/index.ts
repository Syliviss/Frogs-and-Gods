import type { ActionContext, ActionHandler, NotifyFn } from "./_types";
import { SimulatedState, type UpdateInstruction } from "../engine/types";
import { getFrogById, hasFrogActedThisHeartbeat, createPendingAction } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { stepHandler } from "./step";
import { hopHandler } from "./hop";
import { swimHandler } from "./swim";
import { equipHandler } from "./equip";
import { unequipHandler } from "./unequip";
import { throwHandler } from "./throw";
import { storeHandler } from "./store";
import { giveHandler } from "./give";
import { swingHandler } from "./swing";
import { flingHandler, flingPredatorHandler } from "./fling";
import { pickupHandler } from "./pickup";
import { createItemHandler } from "./create_item";
import { spawnItemHandler } from "./spawn_item";
import { spawnPredatorHandler } from "./spawn";
import { killPredatorHandler } from "./kill_predator";
import { createGodHandler } from "./create_god";
import { createFrogHandler } from "./create_frog";
import { divineHealFrogHandler } from "./divine_heal_frog";
import { divineSmiteEnemyHandler } from "./divine_smite_enemy";
import { divineSpawnItemHandler } from "./divine_spawn_item";
import { divineSpawnPredatorHandler } from "./divine_spawn_predator";
import { godPanHandler } from "./god_pan";
import { divUpdateLairHandler } from "./div_update_lair";
import { divPlaceLairHandler } from "./div_place_lair";
import { openDoorHandler } from "./open_door";
import { croakHandler } from "./croak";
import { slitherHandler } from "./slither";
import { strikeHandler } from "./strike";
import { wrapHandler } from "./wrap";
import { crushHandler } from "./crush";
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
  STEP:          stepHandler,
  HOP:           hopHandler,
  SWIM:          swimHandler,
  EQUIP:         equipHandler,
  UNEQUIP:       unequipHandler,
  THROW:         throwHandler,
  STORE_ITEM:    storeHandler,
  GIVE:          giveHandler,
  SWING:         swingHandler,
  FLING:         flingHandler,
  FLING_CONSUME: flingHandler,
  PICKUP:        pickupHandler,
  OPEN_DOOR:     openDoorHandler,
  CROAK:         croakHandler,
};

export const GOD_ACTION_REGISTRY: Record<string, GodActionHandler> = {
  CREATE_GOD:           createGodHandler,
  CREATE_FROG:          createFrogHandler,
  CREATE_ITEM:          createItemHandler,
  SPAWN_ITEM:           spawnItemHandler,
  SPAWN_PREDATOR:       spawnPredatorHandler,
  KILL_PREDATOR:        killPredatorHandler,
  DIV_HEAL_FROG:        divineHealFrogHandler,
  DIV_SMITE_ENEMY:      divineSmiteEnemyHandler,
  DIV_SPAWN_ITEM:       divineSpawnItemHandler,
  DIV_SPAWN_PREDATOR:   divineSpawnPredatorHandler,
  GOD_PAN:              godPanHandler,
  DIV_UPDATE_LAIR:      divUpdateLairHandler,
  DIV_PLACE_LAIR:       divPlaceLairHandler,
};

export const PREDATOR_ACTION_REGISTRY: Record<string, PredatorActionHandler> = {
  SLITHER: slitherHandler,
  STRIKE:  strikeHandler,
  WRAP:    wrapHandler,
  CRUSH:   crushHandler,
  FLING:   flingPredatorHandler,
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
  const _state = new SimulatedState();
  const _out: UpdateInstruction[] = [];
  const validation = await handler.validate(ctx, _state);

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
  const result = await handler.execute(ctx, _state, _out);

  // Broadcast
  await handler.broadcast(ctx, result, notify);

  return { ok: result.success };
}
