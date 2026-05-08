import { getItemById, updateItem, getChunksByCoords } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { SpawnItemPayloadSchema } from "../../shared/game.schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";

const CHUNK_SIZE = 16;

export const spawnItemHandler: GodActionHandler = {
  async validate(ctx: GodActionContext): Promise<GodActionResult> {
    const result = SpawnItemPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    const { itemId, targetX, targetY } = result.data;

    const item = await getItemById(itemId);
    if (!item) return { success: false, error: `Item ${itemId} not found.` };

    const chunkX = Math.floor(targetX / CHUNK_SIZE);
    const chunkY = Math.floor(targetY / CHUNK_SIZE);
    const chunks = await getChunksByCoords([{ chunkX, chunkY }]);
    if (chunks.length === 0) {
      return { success: false, error: `Chunk (${chunkX}, ${chunkY}) does not exist. Spawn the chunk first.` };
    }

    return { success: true };
  },

  async execute(ctx: GodActionContext): Promise<GodActionResult> {
    const { itemId, targetX, targetY } = SpawnItemPayloadSchema.parse(ctx.payload);
    await updateItem(itemId, { itemState: "GROUND", gridX: targetX, gridY: targetY, ownerId: null });
    return { success: true, data: { itemId, gridX: targetX, gridY: targetY } };
  },

  async broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): Promise<void> {
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
