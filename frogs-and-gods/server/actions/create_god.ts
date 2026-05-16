import { pushActionLog } from "../engine/actionLog";
import { CreateGodPayloadSchema } from "../../shared/game.schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const createGodHandler: GodActionHandler = {
  validate(ctx: GodActionContext, _state: SimulatedState): GodActionResult {
    const result = CreateGodPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    return { success: true };
  },

  execute(ctx: GodActionContext, _state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const { name, startingPowers } = CreateGodPayloadSchema.parse(ctx.payload);
    const newGod = {
      userId:             null,
      name,
      favor:              100,
      totalInterventions: 0,
      startingPowers,
    };
    out.push({ type: "GOD_INSERT", data: newGod });
    return { success: true, data: { name } };
  },

  broadcast(ctx: GodActionContext, _result: GodActionResult, _notify: NotifyFn): void {
    const { name } = ctx.payload as { name: string };
    pushActionLog({
      text:     `God created: ${name}`,
      x:        0,
      y:        0,
      chunk_id: "0:0",
      category: "god",
    });
  },
};
