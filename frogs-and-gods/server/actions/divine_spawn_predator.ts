// DIV_SPAWN_PREDATOR — God-player version of SPAWN_PREDATOR. Deducts favor.
// payload: { godId, gridX, gridY, enemyType, aiType, speed, hp }
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";
import { SpawnPredatorPayloadSchema } from "../../shared/game.schema";

const FAVOR_COST = 25;

export const divineSpawnPredatorHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };
    if (god.favor < FAVOR_COST) return { success: false, error: `Insufficient favor (need ${FAVOR_COST}, have ${god.favor}).` };

    const result = SpawnPredatorPayloadSchema.safeParse(ctx.payload);
    if (!result.success) return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload." };

    const { gridX, gridY } = result.data;
    const chunkX = Math.floor(gridX / 16);
    const chunkY = Math.floor(gridY / 16);
    const chunk = state.chunks.get(`${chunkX},${chunkY}`);
    if (!chunk || !chunk.terrainDataJson) return { success: false, error: "No chunk at target location." };
    const terrain = JSON.parse(chunk.terrainDataJson) as string[][];
    const tileChar = terrain[gridY - chunkY * 16]?.[gridX - chunkX * 16];
    if (tileChar === "≈") return { success: false, error: "Cannot spawn an enemy in deep water." };

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId = ctx.payload.godId as number;
    const god = state.getGod(godId)!;
    const { gridX, gridY, enemyType, aiType, speed, hp } = SpawnPredatorPayloadSchema.parse(ctx.payload);
    const chunkX = Math.floor(gridX / 16);
    const chunkY = Math.floor(gridY / 16);

    const predator = {
      enemyType,
      aiType,
      gridX,
      gridY,
      chunkX,
      chunkY,
      currentHp: hp,
      currentBreath: 1,
      maxBreath:     1,
      lastMealTick: Math.floor(Date.now() / 10_000),
      statsJson: { speed, segments: [{ x: gridX - 1, y: gridY }, { x: gridX - 2, y: gridY }] },
    };
    out.push({ type: "PREDATOR_INSERT", data: predator });

    const newFavor = god.favor - FAVOR_COST;
    const newInterventions = god.totalInterventions + 1;
    state.updateGod(godId, { favor: newFavor, totalInterventions: newInterventions });
    out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor, totalInterventions: newInterventions } });

    return { success: true, data: { gridX, gridY, enemyType } };
  },

  broadcast(_ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { gridX, gridY, enemyType } = result.data as { gridX: number; gridY: number; enemyType: string };
    pushActionLog({
      text:     `Divine spawn — ${enemyType} unleashed at (${gridX}, ${gridY})`,
      x:        gridX,
      y:        gridY,
      chunk_id: `${Math.floor(gridX / 16)}:${Math.floor(gridY / 16)}`,
      category: "god",
    });
  },
};
