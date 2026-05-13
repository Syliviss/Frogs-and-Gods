import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  createFrog,
  createPendingAction,
  createUserWithOpenId,
  createWorldMapChunk,
  getAllChunkBiomes,
  getChunksByCoords,
  getEquippedItemsByFrogId,
  getFrogById,
  getGodById,
  getInventoryItemsByFrogId,
  getItemById,
  getItemStats,
  getWorldChunkStats,
  hasPendingActionForFrog,
  listAllFrogs,
  listAllGods,
  listAllUsers,
  listRecentItems,
  listRecentPredators,
  listWorldMapChunks,
  setUserRole,
  updateFrog,
  updateGod,
} from "../db";
import { POI_REGISTRY } from "../worldgen/index";
import type { FrogStats } from "../../drizzle/schema";
import { xpToNextLevel } from "../engine/xpDistributor";
import {
  ActionSchemaSchema,
  CreateFrogSchema,
  CreateItemPayloadSchema,
  GetChunksByCoordsSchema,
  KillPredatorPayloadSchema,
  MoveTypeSchema,
  SpawnChunkSchema,
  SpawnItemPayloadSchema,
  SpawnPredatorPayloadSchema,
  type FrogSpecies,
} from "../../shared/game.schema";
import { validateAndQueueMovement } from "../engine/movement";
import { chebyshevDistance } from "../../shared/movement";

const SPECIES_MODIFIERS: Record<FrogSpecies, Partial<FrogStats>> = {
  BULL_FROG:        { str: 1, maxHp: 1 },
  TREE_FROG:        { dex: 2 },
  SHAMEN_FROG:      { maxMana: 1, int: 1 },
  OLD_FROG:         { maxHp: -2, str: -2, wis: 3, maxMana: 2 },
  GUIRO_FROG:       { cha: 4 },
  POISON_DART_FROG: {},
};
import { generateChunk, MACRO_GRID, WORLD_SEED } from "../worldgen/index";

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
        maxHp:               Math.max(1, base.maxHp   + (mods.maxHp   ?? 0)),
        maxMana:             Math.max(1, base.maxMana  + (mods.maxMana ?? 0)),
        str:                 Math.max(1, base.str      + (mods.str     ?? 0)),
        dex:                 Math.max(1, base.dex      + (mods.dex     ?? 0)),
        wis:                 Math.max(1, base.wis      + (mods.wis     ?? 0)),
        int:                 Math.max(1, base.int      + (mods.int     ?? 0)),
        cha:                 Math.max(1, base.cha      + (mods.cha     ?? 0)),
        inventoryCapacity:   6,
        equipCapacity:       3,
        equippedAttackBonus: 0,
        equippedDefenseBonus: 0,
        equippedHpBonus:     0,
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
      const { grid: terrainGrid, biome: resolvedBiome } = generateChunk(input.chunkX, input.chunkY, WORLD_SEED, MACRO_GRID);
      const chunk = await createWorldMapChunk({
        chunkX:          input.chunkX,
        chunkY:          input.chunkY,
        chunkSize:       input.chunkSize,
        biome:           resolvedBiome,
        terrainDataJson: terrainGrid ? JSON.stringify(terrainGrid) : null,
      });
      return { success: true, chunk };
    }),

  listChunks: publicProcedure.query(async () => {
    return listWorldMapChunks();
  }),

  getAllChunkBiomes: publicProcedure.query(async () => {
    return getAllChunkBiomes();
  }),

  getPoiRegistry: publicProcedure.query(() => {
    return POI_REGISTRY.map((poi) => ({
      id:        poi.id,
      name:      poi.name,
      type:      poi.type,
      anchorX:   poi.anchorX,
      anchorY:   poi.anchorY,
      tileCount: poi.tiles?.length ?? 0,
    }));
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

  createItem: publicProcedure
    .input(CreateItemPayloadSchema)
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       0,
        actionType:    "CREATE_ITEM",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       input,
      });
      return { queued: true, pendingActionId: action.id };
    }),

  spawnItem: publicProcedure
    .input(SpawnItemPayloadSchema)
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       0,
        actionType:    "SPAWN_ITEM",
        resolveBucket: Math.floor(Date.now() / 500),
        targetGridX:   input.targetX,
        targetGridY:   input.targetY,
        payload:       { itemId: input.itemId, targetX: input.targetX, targetY: input.targetY },
      });
      return { queued: true, pendingActionId: action.id };
    }),

  listItems: publicProcedure.query(async () => {
    return listRecentItems(50);
  }),

  getItem: publicProcedure
    .input(z.object({ itemId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getItemById(input.itemId);
    }),

  // ── ENEMIES (DEV) ────────────────────────

  getEnemies: publicProcedure.query(async () => {
    return listRecentPredators(100);
  }),

  triggerSpawn: publicProcedure
    .input(SpawnPredatorPayloadSchema)
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       0,
        actionType:    "SPAWN_PREDATOR",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       input,
        targetGridX:   input.gridX,
        targetGridY:   input.gridY,
      });
      return { queued: true, pendingActionId: action.id };
    }),

  triggerKill: publicProcedure
    .input(KillPredatorPayloadSchema)
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       0,
        actionType:    "KILL_PREDATOR",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       input,
      });
      return { queued: true, pendingActionId: action.id };
    }),

  // ── INVENTORY (DEV) ───────────────────────

  getInventoryForFrog: publicProcedure
    .input(z.object({ frogId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getInventoryItemsByFrogId(input.frogId);
    }),

  getEquippedForFrog: publicProcedure
    .input(z.object({ frogId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getEquippedItemsByFrogId(input.frogId);
    }),

  submitActionForFrog: publicProcedure
    .input(z.object({
      frogId:      z.number().int().positive(),
      actionType:  z.string().min(1).max(64),
      targetGridX: z.number().int().optional(),
      targetGridY: z.number().int().optional(),
      payload:     z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       input.frogId,
        actionType:    input.actionType,
        resolveBucket: Math.floor(Date.now() / 500),
        targetGridX:   input.targetGridX,
        targetGridY:   input.targetGridY,
        payload:       input.payload ?? {},
      });
      return { queued: true, pendingActionId: action.id };
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

  // ── ITEM ACTIONS (Generic Intent Builder) ──

  submitItemActionForFrog: publicProcedure
    .input(z.object({
      frogId:      z.number().int().positive(),
      itemId:      z.string().uuid(),
      action:      z.string().min(1).max(64),
      targetTiles: z.array(z.object({ x: z.number().int(), y: z.number().int() })).min(1).max(16),
    }))
    .mutation(async ({ input }) => {
      // 1. Resolve frog
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      if (frog.isDead)  throw new TRPCError({ code: "BAD_REQUEST", message: "Dead frogs cannot act." });

      // 2. Resolve item
      const item = await getItemById(input.itemId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found." });

      // 3. Item must be EQUIPPED by this frog
      if (item.ownerId !== frog.id || item.itemState !== "EQUIPPED") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Item is not equipped by this frog." });
      }

      // 4. Parse action_schema from the item
      const schemaParse = ActionSchemaSchema.safeParse(item.statsJson.actionSchema);
      if (!schemaParse.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Item has no valid action schema." });
      }
      const schema = schemaParse.data;
      if (schema.action_name !== input.action) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Action mismatch: item grants "${schema.action_name}", not "${input.action}".` });
      }

      // 5. Target tile count must match schema
      if (input.targetTiles.length !== schema.targeting.count) {
        throw new TRPCError({
          code:    "BAD_REQUEST",
          message: `Expected ${schema.targeting.count} target tile(s), got ${input.targetTiles.length}.`,
        });
      }

      // 6. Each tile must be within max_range (Chebyshev from frog)
      for (const tile of input.targetTiles) {
        const dist = chebyshevDistance(frog.gridX, frog.gridY, tile.x, tile.y);
        if (dist > schema.targeting.max_range) {
          throw new TRPCError({
            code:    "BAD_REQUEST",
            message: `Tile (${tile.x},${tile.y}) is ${dist} tiles away — max range is ${schema.targeting.max_range}.`,
          });
        }
      }

      // 7. Poise gate — block if another action is still pending
      const inPoise = await hasPendingActionForFrog(input.frogId);
      if (inPoise) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Frog is in Poise — an action is already pending." });
      }

      // 8. Queue with deferred resolveBucket based on cast_time_ms
      const castBuckets  = Math.ceil(schema.cast_time_ms / 500);
      const resolveBucket = Math.floor(Date.now() / 500) + castBuckets;

      const action = await createPendingAction({
        actorId:       input.frogId,
        actionType:    input.action,
        resolveBucket,
        payload: {
          itemId:      input.itemId,
          targetTiles: input.targetTiles,
        },
      });

      return {
        queued:         true,
        pendingActionId: action.id,
        resolvesInMs:   schema.cast_time_ms,
      };
    }),

});
