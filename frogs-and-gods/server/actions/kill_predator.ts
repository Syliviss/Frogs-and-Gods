import { getPredatorById, deletePredator } from "../db";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import { KillPredatorPayloadSchema } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";

export const killPredatorHandler: GodActionHandler = {
  async validate(ctx: GodActionContext): Promise<GodActionResult> {
    const result = KillPredatorPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    const predator = await getPredatorById(result.data.predatorId);
    if (!predator) {
      return { success: false, error: `Predator #${result.data.predatorId} not found.` };
    }
    return { success: true };
  },

  async execute(ctx: GodActionContext): Promise<GodActionResult> {
    const { predatorId } = KillPredatorPayloadSchema.parse(ctx.payload);
    await deletePredator(predatorId);
    return { success: true, data: { predatorId } };
  },

  async broadcast(ctx: GodActionContext, _result: GodActionResult, _notify: NotifyFn): Promise<void> {
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
