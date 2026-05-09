import { getChunksByCoords, createPredator } from "../db";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import { SpawnPredatorPayloadSchema } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";

export const spawnPredatorHandler: GodActionHandler = {
  async validate(ctx: GodActionContext): Promise<GodActionResult> {
    const result = SpawnPredatorPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    const { gridX, gridY } = result.data;
    const chunkX = Math.floor(gridX / 16);
    const chunkY = Math.floor(gridY / 16);
    const [chunk] = await getChunksByCoords([{ chunkX, chunkY }]);
    if (!chunk || !chunk.terrainDataJson) {
      return { success: false, error: "No chunk exists at target location — spawn a chunk first." };
    }
    const terrain = JSON.parse(chunk.terrainDataJson) as string[][];
    const tileChar = terrain[gridY - chunkY * 16]?.[gridX - chunkX * 16];
    if (tileChar === "≈") {
      return { success: false, error: "Cannot spawn a predator in deep water." };
    }
    return { success: true };
  },

  async execute(ctx: GodActionContext): Promise<GodActionResult> {
    const { gridX, gridY, enemyType, aiType, speed, hp } = SpawnPredatorPayloadSchema.parse(ctx.payload);
    const chunkX = Math.floor(gridX / 16);
    const chunkY = Math.floor(gridY / 16);
    const predator = await createPredator({
      enemyType,
      aiType,
      gridX,
      gridY,
      chunkX,
      chunkY,
      currentHp: hp,
      statsJson: { speed, segments: [{ x: gridX, y: gridY }, { x: gridX, y: gridY }] },
    });
    return { success: true, data: { predator } };
  },

  async broadcast(ctx: GodActionContext, _result: GodActionResult, _notify: NotifyFn): Promise<void> {
    const { gridX, gridY, enemyType } = ctx.payload as { gridX: number; gridY: number; enemyType: string };
    pushActionLog({
      text:     `${enemyType} spawned at (${gridX}, ${gridY})`,
      x:        gridX,
      y:        gridY,
      chunk_id: `${Math.floor(gridX / 16)}:${Math.floor(gridY / 16)}`,
      category: "god",
    });
  },
};
