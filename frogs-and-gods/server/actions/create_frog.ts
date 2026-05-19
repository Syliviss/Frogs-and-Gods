import { pushActionLog } from "../engine/actionLog";
import { generateFrogPixelData } from "../assets/frogModels";
import { CreateFrogSchema, type FrogSpecies } from "../../shared/game.schema";
import type { FrogStats } from "../../drizzle/schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { findSpawnTileNearLair, pickRandomMapEdgeTile, calcMaxBreath } from "./_spawnUtils";

// ─────────────────────────────────────────────
// SPECIES STAT MODIFIERS (duplicated from routers to keep handler self-contained)
// ─────────────────────────────────────────────

const SPECIES_MODIFIERS: Record<FrogSpecies, Partial<FrogStats>> = {
  BULL_FROG:        { str: 1, maxHp: 1 },
  TREE_FROG:        { dex: 2 },
  SHAMEN_FROG:      { maxMana: 1, int: 1 },
  OLD_FROG:         { maxHp: -2, str: -2, wis: 3, maxMana: 2 },
  GUIRO_FROG:       { cha: 4 },
  POISON_DART_FROG: {},
};

// ─────────────────────────────────────────────
// CREATE_FROG PAYLOAD SCHEMA
// ─────────────────────────────────────────────

import { z } from "zod";

export const CreateFrogActionPayloadSchema = CreateFrogSchema.safeExtend({
  userId:          z.number().int().positive(),
  lairInstanceId:  z.number().int().positive().nullable().optional(),
});
export type CreateFrogActionPayload = z.infer<typeof CreateFrogActionPayloadSchema>;

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

export const createFrogHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const result = CreateFrogActionPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }

    const { userId, lairInstanceId } = result.data;

    // One frog per user — check against inhale-loaded frogs
    const existingLiving = Array.from(state.frogs.values()).find(
      f => f.ownerId === userId && !f.isDead
    );
    if (existingLiving) {
      return { success: false, error: `User ${userId} already has a living frog` };
    }

    // Validate lair if specified
    if (lairInstanceId != null) {
      const entranceExists = Array.from(state.lairEntrances.values()).some(
        e => e.instanceId === lairInstanceId
      );
      if (!entranceExists) {
        return { success: false, error: `Lair ${lairInstanceId} has no placed entrance` };
      }
    }

    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const { userId, name, species, distributedStats, lairInstanceId } =
      CreateFrogActionPayloadSchema.parse(ctx.payload);

    // Determine spawn tile
    let spawnX: number;
    let spawnY: number;

    if (lairInstanceId != null) {
      const entrance = Array.from(state.lairEntrances.values()).find(
        e => e.instanceId === lairInstanceId
      );
      if (entrance) {
        const tile = findSpawnTileNearLair(state, entrance.gridX, entrance.gridY);
        spawnX = tile.gridX;
        spawnY = tile.gridY;
      } else {
        const edge = pickRandomMapEdgeTile(userId);
        spawnX = edge.gridX;
        spawnY = edge.gridY;
      }
    } else {
      const edge = pickRandomMapEdgeTile(userId);
      spawnX = edge.gridX;
      spawnY = edge.gridY;
    }

    // Apply species modifiers
    const mods = SPECIES_MODIFIERS[species];
    const base = distributedStats;
    const finalDex = Math.max(1, base.dex + (mods.dex ?? 0));
    const finalStats: FrogStats = {
      maxHp:               Math.max(1, base.maxHp   + (mods.maxHp   ?? 0)),
      maxMana:             Math.max(1, base.maxMana  + (mods.maxMana ?? 0)),
      maxBreath:           calcMaxBreath(finalDex),
      str:                 Math.max(1, base.str      + (mods.str     ?? 0)),
      dex:                 finalDex,
      wis:                 Math.max(1, base.wis      + (mods.wis     ?? 0)),
      int:                 Math.max(1, base.int      + (mods.int     ?? 0)),
      cha:                 Math.max(1, base.cha      + (mods.cha     ?? 0)),
      inventoryCapacity:   6,
      equipCapacity:       3,
      equippedAttackBonus: 0,
      equippedDefenseBonus: 0,
      equippedHpBonus:     0,
    };

    out.push({
      type: "FROG_INSERT",
      data: {
        ownerId:     userId,
        name,
        gridX:       spawnX,
        gridY:       spawnY,
        statsJson:     finalStats,
        currentHp:     finalStats.maxHp,
        currentMana:   finalStats.maxMana,
        currentBreath: finalStats.maxBreath,
        modelJson:   generateFrogPixelData(species),
      },
    });

    return { success: true, data: { name, gridX: spawnX, gridY: spawnY } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, notify: NotifyFn): void {
    const userId = (ctx.payload as CreateFrogActionPayload).userId;

    if (result.success) {
      const { name, gridX, gridY } = result.data as { name: string; gridX: number; gridY: number };
      pushActionLog({
        text:     `Frog "${name}" hatched at (${gridX}, ${gridY})`,
        x:        gridX,
        y:        gridY,
        chunk_id: `${Math.floor(gridX / 16)}:${Math.floor(gridY / 16)}`,
        category: "god",
      });
    } else {
      pushActionLog({
        text:     `CREATE_FROG failed: ${result.error ?? "unknown error"}`,
        x:        0,
        y:        0,
        chunk_id: "0:0",
        category: "god",
      });
      notify(userId, { type: "CREATE_FROG_FAILED", reason: result.error ?? "unknown error" });
    }
  },
};
