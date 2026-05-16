// DIV_SPAWN_ITEM — God-player version of SPAWN_ITEM. Deducts favor.
// payload: { godId, itemId (UUID), targetX, targetY }
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";
import { CHUNK_SIZE } from "../utils/worldGenerator";

const FAVOR_COST = 25;

export const divineSpawnItemHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const itemId = ctx.payload.itemId as string | undefined;
    const targetX = ctx.payload.targetX as number | undefined;
    const targetY = ctx.payload.targetY as number | undefined;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };
    if (god.favor < FAVOR_COST) return { success: false, error: `Insufficient favor (need ${FAVOR_COST}, have ${god.favor}).` };
    if (!itemId) return { success: false, error: "No item specified." };
    if (targetX == null || targetY == null) return { success: false, error: "No target tile specified." };

    const item = state.getItem(itemId);
    if (!item) return { success: false, error: `Item ${itemId} not found.` };

    const chunkX = Math.floor(targetX / CHUNK_SIZE);
    const chunkY = Math.floor(targetY / CHUNK_SIZE);
    const chunk = state.chunks.get(`${chunkX},${chunkY}`);
    if (!chunk) return { success: false, error: `Chunk (${chunkX}, ${chunkY}) does not exist. Spawn it first.` };

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId = ctx.payload.godId as number;
    const itemId = ctx.payload.itemId as string;
    const targetX = ctx.payload.targetX as number;
    const targetY = ctx.payload.targetY as number;

    const god = state.getGod(godId)!;

    state.updateItem(itemId, { itemState: "GROUND", gridX: targetX, gridY: targetY, ownerId: null });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: { itemState: "GROUND", gridX: targetX, gridY: targetY, ownerId: null } });

    const newFavor = god.favor - FAVOR_COST;
    const newInterventions = god.totalInterventions + 1;
    state.updateGod(godId, { favor: newFavor, totalInterventions: newInterventions });
    out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor, totalInterventions: newInterventions } });

    return { success: true, data: { itemId, gridX: targetX, gridY: targetY } };
  },

  broadcast(_ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { itemId, gridX, gridY } = result.data as { itemId: string; gridX: number; gridY: number };
    pushActionLog({
      text:     `Divine gift — item placed at (${gridX}, ${gridY})`,
      x:        gridX,
      y:        gridY,
      chunk_id: `${Math.floor(gridX / CHUNK_SIZE)}:${Math.floor(gridY / CHUNK_SIZE)}`,
      category: "god",
    });
  },
};
