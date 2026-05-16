// DIV_SMITE_ENEMY — Only reached via GOD_ACTION_REGISTRY["DIV_SMITE_ENEMY"].
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";

const FAVOR_COST = 25;
const SMITE_DAMAGE = 50;

export const divineSmiteEnemyHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const targetPredatorId = ctx.payload.targetPredatorId as number | undefined;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };
    if (god.favor < FAVOR_COST) return { success: false, error: `Insufficient favor (need ${FAVOR_COST}, have ${god.favor}).` };
    if (!targetPredatorId) return { success: false, error: "No target enemy specified." };

    const predator = state.getPredator(targetPredatorId);
    if (!predator) return { success: false, error: "Target enemy not found." };
    if (predator.currentHp <= 0) return { success: false, error: "Target enemy is already dead." };

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId = ctx.payload.godId as number;
    const targetPredatorId = ctx.payload.targetPredatorId as number;

    const god = state.getGod(godId)!;
    const predator = state.getPredator(targetPredatorId)!;

    const newHp = predator.currentHp - SMITE_DAMAGE;
    if (newHp <= 0) {
      state.updatePredator(targetPredatorId, { currentHp: 0 });
      out.push({ type: "PREDATOR_DELETE", id: targetPredatorId });
    } else {
      state.updatePredator(targetPredatorId, { currentHp: newHp });
      out.push({ type: "PREDATOR_UPDATE", id: targetPredatorId, changes: { currentHp: newHp } });
    }

    const newFavor = god.favor - FAVOR_COST;
    const newInterventions = god.totalInterventions + 1;
    state.updateGod(godId, { favor: newFavor, totalInterventions: newInterventions });
    out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor, totalInterventions: newInterventions } });

    return { success: true, data: { predatorId: targetPredatorId, slain: newHp <= 0, godId } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { predatorId, slain } = result.data as { predatorId: number; slain: boolean; godId: number };
    const x = (ctx.payload.targetGridX as number) ?? 0;
    const y = (ctx.payload.targetGridY as number) ?? 0;
    pushActionLog({
      text:     slain
        ? `Divine smite — enemy #${predatorId} destroyed`
        : `Divine smite — enemy #${predatorId} struck for ${SMITE_DAMAGE} damage`,
      x,
      y,
      chunk_id: `${Math.floor(x / 16)}:${Math.floor(y / 16)}`,
      category: "god",
    });
  },
};
