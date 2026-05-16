import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  createFrog,
  createInstance,
  createPendingAction,
  createUserWithOpenId,
  createWorldMapChunk,
  getAllChunkBiomes,
  getChunksByCoords,
  getEquippedItemsByFrogId,
  getFrogById,
  getFrogsInBounds,
  getGodById,
  getInstanceById,
  getInstancesByOwnerGodId,
  getInventoryItemsByFrogId,
  getItemById,
  getItemStats,
  getItemsInBounds,
  getLairEntrancesByOwnerGodId,
  getOverridesByChunks,
  getPredatorsInChunkArea,
  getWorldChunkStats,
  hasPendingActionForFrog,
  listAllFrogs,
  listAllGods,
  listAllUsers,
  listRecentItems,
  listRecentPredators,
  listWorldMapChunks,
  setUserRole,
  stageInstanceTileData,
  updateFrog,
  updateGod,
} from "../db";
import { POI_REGISTRY } from "../worldgen/index";
import { generateFrogPixelData } from "../assets/frogModels";
import type { FrogStats } from "../../drizzle/schema";
import { xpToNextLevel } from "../engine/xpDistributor";
import {
  ActionSchemaSchema,
  CreateFrogSchema,
  CreateGodPayloadSchema,
  CreateItemPayloadSchema,
  GetChunksByCoordsSchema,
  GetGodVisionSchema,
  GetMapStudioChunksSchema,
  GodPanSchema,
  KillPredatorPayloadSchema,
  MoveTypeSchema,
  SpawnChunkSchema,
  SpawnItemPayloadSchema,
  SpawnPredatorPayloadSchema,
  SubmitDivineActionSchema,
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
        modelJson:   generateFrogPixelData(input.species),
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

  createGod: publicProcedure
    .input(CreateGodPayloadSchema)
    .mutation(async ({ input }) => {
      const action = await createPendingAction({
        actorId:       0,
        actionType:    "CREATE_GOD",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       input,
      });
      return { queued: true, pendingActionId: action.id };
    }),

  setFavor: publicProcedure
    .input(z.object({
      godId:  z.number().int().positive(),
      amount: z.number().int().min(0).max(10_000),
    }))
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });
      await updateGod(god.id, { favor: input.amount });
      return { success: true };
    }),

  getGodVision: publicProcedure
    .input(GetGodVisionSchema)
    .query(async ({ input }) => {
      const { centerChunkX: ccx, centerChunkY: ccy } = input;
      const coords: { chunkX: number; chunkY: number }[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          coords.push({ chunkX: ccx + dx, chunkY: ccy + dy });
      const minGX = (ccx - 1) * 16;
      const maxGX = (ccx + 2) * 16 - 1;
      const minGY = (ccy - 1) * 16;
      const maxGY = (ccy + 2) * 16 - 1;
      const [chunkRows, frogRows, predRows, itemRows, overrides] = await Promise.all([
        getChunksByCoords(coords),
        getFrogsInBounds(minGX, maxGX, minGY, maxGY),
        getPredatorsInChunkArea(coords),
        getItemsInBounds(minGX, maxGX, minGY, maxGY),
        getOverridesByChunks(coords),
      ]);
      const chunks: Record<string, string[][]> = {};
      for (const c of chunkRows) {
        if (c.terrainDataJson)
          chunks[`${c.chunkX}:${c.chunkY}`] = JSON.parse(c.terrainDataJson) as string[][];
      }
      for (const ov of overrides) {
        const grid = chunks[`${ov.chunkX}:${ov.chunkY}`];
        if (grid) {
          const localX = ov.gridX - ov.chunkX * 16;
          const localY = ov.gridY - ov.chunkY * 16;
          if (grid[localY]) grid[localY][localX] = ov.newChar;
        }
      }
      const groundItems = itemRows.map(({ pixelData: _px, ...rest }) => rest);
      return { chunks, frogs: frogRows, predators: predRows, items: groundItems };
    }),

  getMapStudioChunks: publicProcedure
    .input(GetMapStudioChunksSchema)
    .query(async ({ input }) => {
      const { centerChunkX: ccx, centerChunkY: ccy, radius } = input;
      const coords: { chunkX: number; chunkY: number }[] = [];
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          coords.push({ chunkX: ccx + dx, chunkY: ccy + dy });
      const minGX = (ccx - radius) * 16;
      const maxGX = (ccx + radius + 1) * 16 - 1;
      const minGY = (ccy - radius) * 16;
      const maxGY = (ccy + radius + 1) * 16 - 1;
      const [chunkRows, frogRows, predRows, itemRows, overrides] = await Promise.all([
        getChunksByCoords(coords),
        getFrogsInBounds(minGX, maxGX, minGY, maxGY),
        getPredatorsInChunkArea(coords),
        getItemsInBounds(minGX, maxGX, minGY, maxGY),
        getOverridesByChunks(coords),
      ]);
      const chunks: Record<string, string[][]> = {};
      for (const c of chunkRows) {
        if (c.terrainDataJson)
          chunks[`${c.chunkX}:${c.chunkY}`] = JSON.parse(c.terrainDataJson) as string[][];
      }
      for (const ov of overrides) {
        const grid = chunks[`${ov.chunkX}:${ov.chunkY}`];
        if (grid) {
          const localX = ov.gridX - ov.chunkX * 16;
          const localY = ov.gridY - ov.chunkY * 16;
          if (grid[localY]) grid[localY][localX] = ov.newChar;
        }
      }
      const groundItems = itemRows.map(({ pixelData: _px, ...rest }) => rest);
      return { chunks, frogs: frogRows, predators: predRows, items: groundItems };
    }),

  submitDivineAction: publicProcedure
    .input(SubmitDivineActionSchema)
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });
      if (god.favor < 25) throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient favor (need 25, have ${god.favor}).` });

      const ACTION_TYPE_MAP: Record<string, string> = {
        HEAL_FROG:       "DIV_HEAL_FROG",
        SMITE_ENEMY:     "DIV_SMITE_ENEMY",
        SPAWN_ITEM:      "DIV_SPAWN_ITEM",
        SPAWN_PREDATOR:  "DIV_SPAWN_PREDATOR",
      };
      const actionType = ACTION_TYPE_MAP[input.powerId]!;

      const payload: Record<string, unknown> = {
        godId:           input.godId,
        targetFrogId:    input.targetFrogId,
        targetPredatorId: input.targetPredatorId,
        // SPAWN_ITEM: use itemId/targetX/targetY to match SpawnItemPayloadSchema field names
        itemId:   input.spawnItemTemplateId,
        targetX:  input.targetGridX,
        targetY:  input.targetGridY,
        // SPAWN_PREDATOR: use field names matching SpawnPredatorPayloadSchema
        gridX:     input.targetGridX,
        gridY:     input.targetGridY,
        enemyType: input.spawnEnemyType,
        aiType:    input.spawnEnemyAiType,
        hp:        input.spawnEnemyHp ?? 20,
        speed:     input.spawnEnemySpeed ?? 5,
        // raw target for broadcast logging
        targetGridX: input.targetGridX,
        targetGridY: input.targetGridY,
      };

      const action = await createPendingAction({
        actorId:       input.godId,
        actionType,
        resolveBucket: Math.floor(Date.now() / 500),
        targetGridX:   input.targetGridX,
        targetGridY:   input.targetGridY,
        payload,
      });
      return { queued: true, pendingActionId: action.id };
    }),

  submitGodPan: publicProcedure
    .input(GodPanSchema)
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });
      const action = await createPendingAction({
        actorId:       input.godId,
        actionType:    "GOD_PAN",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       { godId: input.godId, chunkX: input.chunkX, chunkY: input.chunkY },
      });
      return { queued: true, pendingActionId: action.id };
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

  // ── GOD'S LAIR ────────────────────────────

  getLairsByGod: publicProcedure
    .input(z.object({ godId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getInstancesByOwnerGodId(input.godId);
    }),

  getLairEntranceCountForGod: publicProcedure
    .input(z.object({ godId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const entrances = await getLairEntrancesByOwnerGodId(input.godId);
      return { count: entrances.length };
    }),

  stageLairTileData: publicProcedure
    .input(z.object({
      godId:        z.number().int().positive(),
      instanceId:   z.number().int().positive().optional(),
      tileDataJson: z.array(z.array(z.string()).length(16)).length(16),
    }).refine(
      (d) => d.tileDataJson.flat().filter(c => c === "D").length === 1,
      { message: "Tile layout must contain exactly one 'D' tile." }
    ))
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });

      const serialized = JSON.stringify(input.tileDataJson);

      let resolvedInstanceId: number;

      if (!input.instanceId) {
        const newInstance = await createInstance({
          ownerGodId:         input.godId,
          stagedTileDataJson: serialized,
        });
        resolvedInstanceId = newInstance.id;
      } else {
        const existing = await getInstanceById(input.instanceId);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found." });
        if (existing.ownerGodId !== input.godId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Instance does not belong to this god." });
        }
        await stageInstanceTileData(input.instanceId, serialized);
        resolvedInstanceId = input.instanceId;
      }

      const action = await createPendingAction({
        actorId:       input.godId,
        actionType:    "DIV_UPDATE_LAIR",
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       { godId: input.godId, instanceId: resolvedInstanceId },
      });

      return { instanceId: resolvedInstanceId, pendingActionId: action.id };
    }),

  submitDivPlaceLair: publicProcedure
    .input(z.object({
      godId:       z.number().int().positive(),
      instanceId:  z.number().int().positive(),
      targetGridX: z.number().int(),
      targetGridY: z.number().int(),
    }))
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });

      const instance = await getInstanceById(input.instanceId);
      if (!instance) throw new TRPCError({ code: "NOT_FOUND", message: "Instance not found." });
      if (instance.ownerGodId !== input.godId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Instance does not belong to this god." });
      }
      if (!instance.tileDataJson) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Instance layout must be committed before placing an entrance." });
      }

      const action = await createPendingAction({
        actorId:       input.godId,
        actionType:    "DIV_PLACE_LAIR",
        targetGridX:   input.targetGridX,
        targetGridY:   input.targetGridY,
        resolveBucket: Math.floor(Date.now() / 500),
        payload:       {
          godId:       input.godId,
          instanceId:  input.instanceId,
          targetGridX: input.targetGridX,
          targetGridY: input.targetGridY,
        },
      });

      return { queued: true, pendingActionId: action.id };
    }),

});
