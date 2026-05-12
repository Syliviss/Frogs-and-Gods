import {
  calculateRemainingMove,
  chebyshevDistance,
  MOVE_MAX_RANGE,
  type MoveType,
} from "../../shared/movement";
import type { TileChar } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { getTerrainAt, rollConditionCheck, checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export function makeMoveHandler(actionType: MoveType): ActionHandler {
  return {
    validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
      const frog = ctx.frog!;

      // Condition check: wrappedBy etc. Pass a scratch array — any escape UpdateInstructions
      // will be emitted for real in execute() below, which re-runs the check with the real out[].
      const scratchOut: UpdateInstruction[] = [];
      const condition = rollConditionCheck(frog, state, scratchOut);
      if (!condition.ok) return condition;

      const fumble = checkItemFumble(frog.id, actionType, state);
      if (fumble) return fumble;

      if (ctx.targetGridX == null || ctx.targetGridY == null) {
        return { ok: false, message: "Target coordinates required." };
      }

      const dist = chebyshevDistance(frog.gridX, frog.gridY, ctx.targetGridX, ctx.targetGridY);
      const maxRange = MOVE_MAX_RANGE[actionType];
      if (dist > maxRange) {
        return { ok: false, message: `${actionType} max range is ${maxRange} tiles.` };
      }

      const targetChar = getTerrainAt(state, ctx.targetGridX, ctx.targetGridY);
      const moveResult = calculateRemainingMove(actionType, frog.statsJson, "#" as TileChar, targetChar);
      
      if (!moveResult.legal) {
        return {
          ok: false,
          message: `Not enough movement points (cost ${moveResult.cost}).`,
        };
      }

      return { ok: true };
    },

    execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
      const frog = ctx.frog!;
      const tx   = ctx.targetGridX!;
      const ty   = ctx.targetGridY!;

      // Re-run condition check with the real out[] so escape instructions are committed.
      // If validate() already confirmed escape is possible, this will clear the condition.
      const freshFrog = state.getFrog(frog.id) ?? frog;
      rollConditionCheck(freshFrog, state, out);

      const targetChar = getTerrainAt(state, tx, ty);
      const moveResult = calculateRemainingMove(actionType, frog.statsJson, "#" as TileChar, targetChar);

      if (moveResult.legal) {
        state.updateFrog(frog.id, { gridX: tx, gridY: ty });
        out.push({ type: "FROG_UPDATE", id: frog.id, changes: { gridX: tx, gridY: ty } });
      }

      return { success: moveResult.legal, data: { targetGridX: tx, targetGridY: ty, legal: moveResult.legal } };
    },

    async broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): Promise<void> {
      const frog = ctx.frog!;
      const tx   = ctx.targetGridX!;
      const ty   = ctx.targetGridY!;
      const data = result.data as { legal: boolean } | undefined;
      const legal = data?.legal ?? false;

      const verbs: Record<string, string> = { STEP: "steps", HOP: "hops", DASH: "dashes" };
      const verb = verbs[actionType] ?? "moves";

      pushActionLog({
        text:     legal
          ? `${frog.name} ${verb} to (${tx}, ${ty})`
          : `${frog.name}'s ${verb} to (${tx}, ${ty}) was blocked`,
        x:        tx,
        y:        ty,
        chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
        category: "movement",
      });

      if (frog.ownerId != null) {
        notify(frog.ownerId, {
          type:        "ACTION_RESOLVED",
          actionType,
          legal,
          targetGridX: tx,
          targetGridY: ty,
        });
      }
    },
  };
}
