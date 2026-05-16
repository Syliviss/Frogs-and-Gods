// GOD_PAN — Queues a camera pan for the God's View tab.
// Pure event: validates coordinates and god existence, executes as no-op, logs the move.
// The camera update is applied client-side on the next ENGINE_TICK via useTickSync.
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";

export const godPanHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const chunkX = ctx.payload.chunkX as number;
    const chunkY = ctx.payload.chunkY as number;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };
    if (Math.abs(chunkX) > 312 || Math.abs(chunkY) > 312) {
      return { success: false, error: "Coordinates out of world bounds." };
    }

    return { success: true };
  },

  execute(_ctx: GodActionContext, _state: SimulatedState, _out: UpdateInstruction[]): GodActionResult {
    return { success: true };
  },

  broadcast(ctx: GodActionContext, _result: GodActionResult, _notify: NotifyFn): void {
    const { chunkX, chunkY } = ctx.payload as { chunkX: number; chunkY: number };
    pushActionLog({
      text:     `God's gaze shifts to chunk (${chunkX}, ${chunkY})`,
      x:        chunkX * 16,
      y:        chunkY * 16,
      chunk_id: `${chunkX}:${chunkY}`,
      category: "god",
    });
  },
};
