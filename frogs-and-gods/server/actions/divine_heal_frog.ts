// DIV_HEAL_FROG — Only reached via GOD_ACTION_REGISTRY["DIV_HEAL_FROG"].
// ctx.payload.godId is the actorId from pending_actions; guaranteed to be a god ID
// because this action type is exclusive to the GOD_ACTION_TYPES registry.
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";

const FAVOR_COST = 25;
const HEAL_AMOUNT = 25;

export const divineHealFrogHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const targetFrogId = ctx.payload.targetFrogId as number | undefined;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };
    if (god.favor < FAVOR_COST) return { success: false, error: `Insufficient favor (need ${FAVOR_COST}, have ${god.favor}).` };
    if (!targetFrogId) return { success: false, error: "No target frog specified." };

    const frog = state.getFrog(targetFrogId);
    if (!frog) return { success: false, error: "Target frog not found." };
    if (frog.isDead) return { success: false, error: "Cannot heal a dead frog." };

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId = ctx.payload.godId as number;
    const targetFrogId = ctx.payload.targetFrogId as number;

    const god = state.getGod(godId)!;
    const frog = state.getFrog(targetFrogId)!;

    const newHp = Math.min(frog.currentHp + HEAL_AMOUNT, frog.statsJson.maxHp);
    state.updateFrog(targetFrogId, { currentHp: newHp });
    out.push({ type: "FROG_UPDATE", id: targetFrogId, changes: { currentHp: newHp } });

    const newFavor = god.favor - FAVOR_COST;
    const newInterventions = god.totalInterventions + 1;
    state.updateGod(godId, { favor: newFavor, totalInterventions: newInterventions });
    out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor, totalInterventions: newInterventions } });

    return { success: true, data: { frogId: targetFrogId, healed: newHp - frog.currentHp, godId } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { frogId, healed } = result.data as { frogId: number; healed: number; godId: number };
    const x = (ctx.payload.targetGridX as number) ?? 0;
    const y = (ctx.payload.targetGridY as number) ?? 0;
    pushActionLog({
      text:     `Divine heal — frog #${frogId} restored ${healed} HP`,
      x,
      y,
      chunk_id: `${Math.floor(x / 16)}:${Math.floor(y / 16)}`,
      category: "god",
    });
  },
};
