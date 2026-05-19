import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CreateFrogSchema,
  GetPlayerVisionSchema,
  MoveActionSchema,
} from "../shared/game.schema";
import { validateAndQueueMovement } from "./engine/movement";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import {
  createGod,
  createPendingAction,
  getChunksByCoords,
  getEquippedItemsByFrogId,
  getGroundItemsNear,
  getFrogById,
  getFrogByOwnerId,
  getFrogsByOwnerId,
  getFrogsInBounds,
  getFrogsByInstanceId,
  getGodByUserId,
  getInstanceById,
  getItemsInBounds,
  getItemPixelDataByIds,
  getItemsByInstanceId,
  getLairEntrancesByGridPositions,
  getOverridesByChunks,
  getPredatorsInChunkArea,
  getPredatorsByInstanceId,
  getRandomGodLairs,
  getRecentWorldLog,
  updateFrog,
} from "./db";
import { CHUNK_SIZE } from "./utils/worldGenerator";

// ─────────────────────────────────────────────
// APP ROUTER
// ─────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  admin:  adminRouter,

  // ── FROG ──────────────────────────────────
  frog: router({
    myFrog: protectedProcedure.query(async ({ ctx }) => {
      return getFrogByOwnerId(ctx.user.id) ?? null;
    }),

    getFrogById: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        return getFrogById(input.id) ?? null;
      }),

    create: protectedProcedure
      .input(CreateFrogSchema)
      .mutation(async ({ ctx, input }) => {
        // Pre-validate synchronously to give immediate feedback for common case
        const existingFrogs = await getFrogsByOwnerId(ctx.user.id);
        if (existingFrogs.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "You already have an active Frog." });
        }

        await createPendingAction({
          actorId:       0,
          actionType:    "CREATE_FROG",
          resolveBucket: Math.floor(Date.now() / 500),
          payload:       {
            userId:         ctx.user.id,
            name:           input.name,
            species:        input.species,
            distributedStats: input.distributedStats,
            lairInstanceId: input.lairInstanceId ?? null,
          },
        });
        return { queued: true };
      }),

    getRandomLairs: publicProcedure
      .input(z.object({ count: z.number().int().min(1).max(10).default(5) }))
      .query(async ({ input }) => {
        return getRandomGodLairs(input.count);
      }),

    submitMovement: protectedProcedure
      .input(MoveActionSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await validateAndQueueMovement(
          ctx.user.id,
          input.actionType,
          input.targetGridX,
          input.targetGridY,
        );
        if (!result.ok) {
          const code = result.code === "NO_FROG" || result.code === "FROG_DEAD"
            ? "FORBIDDEN" as const
            : "BAD_REQUEST" as const;
          throw new TRPCError({ code, message: result.message });
        }
        return { queued: true, pendingActionId: result.pendingActionId };
      }),

    getPlayerVision: protectedProcedure
      .input(GetPlayerVisionSchema)
      .query(async ({ input }) => {
        const frog = await getFrogById(input.frogId);
        if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });

        if (frog.instanceId !== null) {
          const instance = await getInstanceById(frog.instanceId);
          if (!instance || !instance.tileDataJson) {
            return { chunks: {}, frogs: [], predators: [], items: [] };
          }
          const grid = JSON.parse(instance.tileDataJson) as string[][];
          const [instanceFrogs, instancePredators, instanceItems] = await Promise.all([
            getFrogsByInstanceId(frog.instanceId),
            getPredatorsByInstanceId(frog.instanceId),
            getItemsByInstanceId(frog.instanceId),
          ]);
          return { chunks: { "0:0": grid }, frogs: instanceFrogs, predators: instancePredators, items: instanceItems };
        }

        const centerCX = Math.floor(frog.gridX / CHUNK_SIZE);
        const centerCY = Math.floor(frog.gridY / CHUNK_SIZE);

        const coords: { chunkX: number; chunkY: number }[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            coords.push({ chunkX: centerCX + dx, chunkY: centerCY + dy });

        const minGX = (centerCX - 1) * CHUNK_SIZE;
        const maxGX = (centerCX + 2) * CHUNK_SIZE - 1;
        const minGY = (centerCY - 1) * CHUNK_SIZE;
        const maxGY = (centerCY + 2) * CHUNK_SIZE - 1;

        const [chunkRows, frogRows, predatorRows, itemRows, overrides] = await Promise.all([
          getChunksByCoords(coords),
          getFrogsInBounds(minGX, maxGX, minGY, maxGY),
          getPredatorsInChunkArea(coords),
          getItemsInBounds(minGX, maxGX, minGY, maxGY),
          getOverridesByChunks(coords),
        ]);

        const chunks: Record<string, string[][]> = {};
        for (const chunk of chunkRows) {
          if (chunk.terrainDataJson)
            chunks[`${chunk.chunkX}:${chunk.chunkY}`] = JSON.parse(chunk.terrainDataJson) as string[][];
        }

        for (const ov of overrides) {
          const grid = chunks[`${ov.chunkX}:${ov.chunkY}`];
          if (grid) {
            const localX = ov.gridX - ov.chunkX * 16;
            const localY = ov.gridY - ov.chunkY * 16;
            if (grid[localY]) grid[localY][localX] = ov.newChar;
          }
        }

        return { chunks, frogs: frogRows, predators: predatorRows, items: itemRows };
      }),

    getItemPixelData: publicProcedure
      .input(z.object({ itemIds: z.array(z.string()).min(1).max(64) }))
      .query(async ({ input }) => {
        return getItemPixelDataByIds(input.itemIds);
      }),

    getEquippedActions: protectedProcedure
      .input(z.object({ frogId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const equipped = await getEquippedItemsByFrogId(input.frogId);
        // Return richer objects so the client can build the Generic Intent Builder
        // when an item has an actionSchema, without hardcoding anything weapon-specific.
        return equipped.flatMap((item) =>
          (item.statsJson.grantedActions ?? []).map((actionName) => ({
            actionName,
            itemId:       item.itemId,
            actionSchema: item.statsJson.actionSchema ?? null,
          })),
        );
      }),

    getNearbyGroundItems: publicProcedure
      .input(z.object({ frogId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const frog = await getFrogById(input.frogId);
        if (!frog) return [];
        const nearby = await getGroundItemsNear(frog.gridX, frog.gridY, 1);
        return nearby.map(i => ({ itemId: i.itemId, name: i.name, gridX: i.gridX!, gridY: i.gridY! }));
      }),

    getLairEntranceAtTile: publicProcedure
      .input(z.object({ gridX: z.number().int(), gridY: z.number().int() }))
      .query(async ({ input }) => {
        const [entry] = await getLairEntrancesByGridPositions([{ gridX: input.gridX, gridY: input.gridY }]);
        return entry ? { instanceId: entry.instanceId, gridX: entry.gridX, gridY: entry.gridY } : null;
      }),
  }),

  // ── GOD ───────────────────────────────────
  god: router({
    myGod: protectedProcedure.query(async ({ ctx }) => {
      return getGodByUserId(ctx.user.id) ?? null;
    }),

    register: protectedProcedure
      .input(z.object({ name: z.string().min(2).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getGodByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "You are already a God." });
        await createGod({ userId: ctx.user.id, name: input.name });
        return { success: true };
      }),
  }),

  // ── WORLD LOG ─────────────────────────────
  worldLog: router({
    recent: publicProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }))
      .query(async ({ input }) => {
        const events = await getRecentWorldLog(input.limit);
        return events.map((e) => ({
          ...e,
          payload: JSON.parse(e.payload) as unknown,
        }));
      }),
  }),
});

export type AppRouter = typeof appRouter;
