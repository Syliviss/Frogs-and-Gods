import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  createFrog,
  createItem,
  createUserWithOpenId,
  createWorldMapChunk,
  getChunksByCoords,
  getFrogById,
  getGodById,
  getItemStats,
  getWorldChunkStats,
  listAllFrogs,
  listAllGods,
  listAllUsers,
  listRecentItems,
  listWorldMapChunks,
  setUserRole,
  updateFrog,
  updateGod,
} from "../db";
import type { FrogStats } from "../../drizzle/schema";
import { xpToNextLevel } from "../engine/xpDistributor";
import {
  CreateFrogSchema,
  GetChunksByCoordsSchema,
  MoveTypeSchema,
  SpawnChunkSchema,
  SpawnItemSchema,
  type FrogSpecies,
} from "../../shared/game.schema";
import { validateAndQueueMovement } from "../engine/movement";

const SPECIES_MODIFIERS: Record<FrogSpecies, Partial<FrogStats>> = {
  BULL_FROG:        { str: 1, maxHp: 1 },
  TREE_FROG:        { dex: 2 },
  SHAMEN_FROG:      { maxMana: 1, int: 1 },
  OLD_FROG:         { maxHp: -2, str: -2, wis: 3, maxMana: 2 },
  GUIRO_FROG:       { cha: 4 },
  POISON_DART_FROG: {},
};
import { generateChunk, WORLD_SEED } from "../utils/worldGenerator";

// ─────────────────────────────────────────────
// ADMIN ROUTER
// ─────────────────────────────────────────────

export const adminRouter = router({

  // ── USERS ─────────────────────────────────

  listUsers: publicProcedure.query(async () => {
    return listAllUsers();
  }),

  setUserRole: publicProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      role:   z.enum(["frog", "god", "admin"]),
    }))
    .mutation(async ({ input }) => {
      await setUserRole(input.userId, input.role);
      return { success: true };
    }),

  // ── FROGS ─────────────────────────────────

  listFrogs: publicProcedure.query(async () => {
    return listAllFrogs();
  }),

  createTestFrog: publicProcedure
    .input(CreateFrogSchema)
    .mutation(async ({ input }) => {
      const openId  = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ownerId = await createUserWithOpenId(openId, `TestUser_${input.name}`);

      const mods = SPECIES_MODIFIERS[input.species];
      const base = input.distributedStats;
      const finalStats: FrogStats = {
        maxHp:   Math.max(1, base.maxHp   + (mods.maxHp   ?? 0)),
        maxMana: Math.max(1, base.maxMana  + (mods.maxMana ?? 0)),
        str:     Math.max(1, base.str      + (mods.str     ?? 0)),
        dex:     Math.max(1, base.dex      + (mods.dex     ?? 0)),
        wis:     Math.max(1, base.wis      + (mods.wis     ?? 0)),
        int:     Math.max(1, base.int      + (mods.int     ?? 0)),
        cha:     Math.max(1, base.cha      + (mods.cha     ?? 0)),
      };

      await createFrog({
        ownerId,
        name:        input.name,
        gridX:       0,
        gridY:       0,
        statsJson:   finalStats,
        currentHp:   finalStats.maxHp,
        currentMana: finalStats.maxMana,
      });
      return { success: true, openId };
    }),

  grantXp: publicProcedure
    .input(z.object({
      frogId: z.number().int().positive(),
      amount: z.number().int().positive().max(100_000),
    }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });

      let newXp    = frog.currentXp + input.amount;
      let newLevel = frog.level;
      let leveled  = false;

      while (newXp >= xpToNextLevel(newLevel)) {
        newXp -= xpToNextLevel(newLevel);
        newLevel++;
        leveled = true;
      }

      await updateFrog(frog.id, {
        currentXp:     newXp,
        level:         newLevel,
        xpToNextLevel: xpToNextLevel(newLevel),
      });

      return { success: true, leveled, newLevel, newXp };
    }),

  resurrectFrog: publicProcedure
    .input(z.object({ frogId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      const stats = frog.statsJson;
      await updateFrog(frog.id, {
        isDead:      false,
        currentHp:   stats.maxHp,
        currentMana: stats.maxMana,
      });
      return { success: true };
    }),

  // ── GODS ──────────────────────────────────

  listGods: publicProcedure.query(async () => {
    return listAllGods();
  }),

  setDivinePower: publicProcedure
    .input(z.object({
      godId:  z.number().int().positive(),
      amount: z.number().int().min(0).max(10_000),
    }))
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });
      await updateGod(god.id, { divinePower: input.amount });
      return { success: true };
    }),

  // ── WORLD MAP CHUNKS & ITEMS ──────────────

  getWorldStats: publicProcedure.query(async () => {
    const [chunkStats, itemStats] = await Promise.all([
      getWorldChunkStats(),
      getItemStats(),
    ]);
    return { ...chunkStats, ...itemStats };
  }),

  spawnChunk: publicProcedure
    .input(SpawnChunkSchema)
    .mutation(async ({ input }) => {
      const terrainGrid = generateChunk(input.chunkX, input.chunkY, WORLD_SEED);
      const chunk = await createWorldMapChunk({
        chunkX:          input.chunkX,
        chunkY:          input.chunkY,
        chunkSize:       input.chunkSize,
        biome:           input.biome,
        terrainDataJson: JSON.stringify(terrainGrid),
      });
      return { success: true, chunk };
    }),

  listChunks: publicProcedure.query(async () => {
    return listWorldMapChunks();
  }),

  getChunksByCoords: publicProcedure
    .input(GetChunksByCoordsSchema)
    .query(async ({ input }) => {
      const chunks = await getChunksByCoords(input.coords);
      const result: Record<string, string[][]> = {};
      for (const chunk of chunks) {
        if (chunk.terrainDataJson) {
          result[`${chunk.chunkX}:${chunk.chunkY}`] = JSON.parse(chunk.terrainDataJson) as string[][];
        }
      }
      return result;
    }),

  spawnItem: publicProcedure
    .input(SpawnItemSchema)
    .mutation(async ({ input }) => {
      const itemId = crypto.randomUUID();
      const item = await createItem({
        itemId,
        name:       input.name,
        rarityTier: input.rarityTier,
        statsJson:  input.stats,
        ownerType:  input.ownerType,
        ownerId:    input.ownerId ?? undefined,
        gridX:      input.gridX ?? undefined,
        gridY:      input.gridY ?? undefined,
      });
      return { success: true, item };
    }),

  listItems: publicProcedure.query(async () => {
    return listRecentItems(50);
  }),

  // ── MOVEMENT (DEV) ────────────────────────

  submitMovementForFrog: publicProcedure
    .input(z.object({
      frogId:      z.number().int().positive(),
      actionType:  MoveTypeSchema,
      targetGridX: z.number().int(),
      targetGridY: z.number().int(),
    }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      if (frog.ownerId === null) throw new TRPCError({ code: "BAD_REQUEST", message: "Frog has no owner." });
      const result = await validateAndQueueMovement(
        frog.ownerId,
        input.actionType,
        input.targetGridX,
        input.targetGridY,
      );
      if (!result.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      return { queued: true, pendingActionId: result.pendingActionId };
    }),

});
