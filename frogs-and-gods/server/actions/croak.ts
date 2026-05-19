import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import type { FrogStats } from "../../drizzle/schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const croakHandler: ActionHandler = {
  validate(_ctx: ActionContext, _state: SimulatedState): ValidationResult {
    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const maxBreath = (frog.statsJson as FrogStats).maxBreath ?? 5;
    state.updateFrog(ctx.frogId, { currentBreath: maxBreath });
    out.push({ type: "FROG_UPDATE", id: ctx.frogId, changes: { currentBreath: maxBreath } });
    return { success: true, data: { maxBreath } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, _notify: NotifyFn): void {
    const frog = ctx.frog!;
    const { maxBreath } = result.data as { maxBreath: number };
    pushActionLog({
      text:     `${frog.name} croaks! (breath restored to ${maxBreath})`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });
  },
};
