import { pushActionLog } from "../engine/actionLog";
import { SpawnItemPayloadSchema } from "../../shared/game.schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const spawnItemHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const result = SpawnItemPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    const { itemId, targetX, targetY } = result.data;

    const item = state.getItem(itemId);
    if (!item) return { success: false, error: `Item ${itemId} not found.` };

    const chunkX = Math.floor(targetX / CHUNK_SIZE);
    const chunkY = Math.floor(targetY / CHUNK_SIZE);
    const chunk = state.chunks.get(`${chunkX},${chunkY}`);
    if (!chunk) {
      return { success: false, error: `Chunk (${chunkX}, ${chunkY}) does not exist. Spawn the chunk first.` };
    }

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const { itemId, targetX, targetY } = SpawnItemPayloadSchema.parse(ctx.payload);
    state.updateItem(itemId, { itemState: "GROUND", gridX: targetX, gridY: targetY, ownerId: null });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: { itemState: "GROUND", gridX: targetX, gridY: targetY, ownerId: null } });
    return { success: true, data: { itemId, gridX: targetX, gridY: targetY } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { itemId, gridX, gridY } = result.data as { itemId: string; gridX: number; gridY: number };
    const chunkX = Math.floor(gridX / CHUNK_SIZE);
    const chunkY = Math.floor(gridY / CHUNK_SIZE);
    pushActionLog({
      text:     `Item ${itemId} spawned at (${gridX}, ${gridY})`,
      x:        gridX,
      y:        gridY,
      chunk_id: `${chunkX}:${chunkY}`,
      category: "god",
    });
  },
};
