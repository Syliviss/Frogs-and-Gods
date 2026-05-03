import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CreateFrogSchema,
  CreatePartySchema,
  JoinPartySchema,
  PartyInviteSchema,
  type FrogSpecies,
} from "../shared/game.schema";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import {
  acceptPartyInvite,
  createFrog,
  createGod,
  createParty,
  createPartyInvite,
  getFrogById,
  getFrogByOwnerId,
  getFrogsByPartyId,
  getGodByUserId,
  getPendingInvitesForFrog,
  getRecentWorldLog,
  updateFrog,
} from "./db";
import type { FrogStats } from "../drizzle/schema";

// ─────────────────────────────────────────────
// SPECIES STAT MODIFIERS
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
        const existing = await getFrogByOwnerId(ctx.user.id);
        if (existing && !existing.isDead) {
          throw new TRPCError({ code: "CONFLICT", message: "You already have an active Frog." });
        }

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
          ownerId:      ctx.user.id,
          name:         input.name,
          gridX:        0,
          gridY:        0,
          statsJson:    finalStats,
          currentHp:    finalStats.maxHp,
          currentMana:  finalStats.maxMana,
        });
        return { success: true };
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

  // ── PARTY ─────────────────────────────────
  party: router({
    create: protectedProcedure
      .input(CreatePartySchema)
      .mutation(async ({ ctx, input }) => {
        const frog = await getFrogByOwnerId(ctx.user.id);
        if (!frog) throw new TRPCError({ code: "FORBIDDEN", message: "Only Frogs can create parties." });
        if (frog.isDead) throw new TRPCError({ code: "FORBIDDEN", message: "Dead Frogs cannot create parties." });

        const party = await createParty({ name: input.name, leaderId: frog.id });
        await updateFrog(frog.id, { partyId: party.id });
        return party;
      }),

    invite: protectedProcedure
      .input(PartyInviteSchema)
      .mutation(async ({ ctx, input }) => {
        const frog = await getFrogByOwnerId(ctx.user.id);
        if (!frog || !frog.partyId) throw new TRPCError({ code: "FORBIDDEN", message: "You must be in a party to invite." });
        if (frog.partyId !== input.partyId) throw new TRPCError({ code: "FORBIDDEN", message: "You can only invite to your own party." });

        const targetFrog = await getFrogById(input.invitedFrogId);
        if (!targetFrog) throw new TRPCError({ code: "NOT_FOUND", message: "Target Frog not found." });
        if (targetFrog.isDead) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot invite a dead Frog." });

        const members = await getFrogsByPartyId(input.partyId);
        if (members.length >= 4) throw new TRPCError({ code: "BAD_REQUEST", message: "Party is full (max 4)." });

        await createPartyInvite(input.partyId, input.invitedFrogId, frog.id);
        return { success: true };
      }),

    join: protectedProcedure
      .input(JoinPartySchema)
      .mutation(async ({ ctx, input }) => {
        const frog = await getFrogByOwnerId(ctx.user.id);
        if (!frog) throw new TRPCError({ code: "FORBIDDEN", message: "Only Frogs can join parties." });
        if (frog.isDead) throw new TRPCError({ code: "FORBIDDEN", message: "Dead Frogs cannot join parties." });

        const party = await acceptPartyInvite(input.inviteId, frog.id);
        if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already processed." });
        return party;
      }),

    myParty: protectedProcedure.query(async ({ ctx }) => {
      const frog = await getFrogByOwnerId(ctx.user.id);
      if (!frog || !frog.partyId) return null;
      const members = await getFrogsByPartyId(frog.partyId);
      return { partyId: frog.partyId, members };
    }),

    pendingInvites: protectedProcedure.query(async ({ ctx }) => {
      const frog = await getFrogByOwnerId(ctx.user.id);
      if (!frog) return [];
      return getPendingInvitesForFrog(frog.id);
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
