import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import { KillPredatorPayloadSchema } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";
import { dropPredatorLoot } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const killPredatorHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const result = KillPredatorPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    const predatorId = result.data.predatorId;
    const predator = state.predators.get(predatorId);
    if (!predator) {
      return { success: false, error: `Predator #${predatorId} not found.` };
    }
    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const { predatorId } = KillPredatorPayloadSchema.parse(ctx.payload);
    const predator = state.getPredator(predatorId);
    if (predator) dropPredatorLoot(predator, out);
    state.predators.delete(predatorId);
    out.push({ type: "PREDATOR_DELETE", id: predatorId });
    return { success: true, data: { predatorId } };
  },

  broadcast(ctx: GodActionContext, _result: GodActionResult, _notify: NotifyFn): void {
    const { predatorId } = ctx.payload as { predatorId: number };
    pushActionLog({
      text:     `Predator #${predatorId} smited by divine will`,
      x:        0,
      y:        0,
      chunk_id: "0:0",
      category: "god",
    });
  },
};
