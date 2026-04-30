import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CreatePartySchema,
  GodInterventionSchema,
  JoinPartySchema,
  PartyInviteSchema,
  RegisterFrogSchema,
  RegisterGodSchema,
} from "../shared/game.schema";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { adminRouter } from "./routers/admin";
import {
  acceptPartyInvite,
  createFrog,
  createGod,
  createParty,
  createPartyInvite,
  createWorldLogEvent,
  getEncounterById,
  getFrogById,
  getFrogByUserId,
  getFrogInventory,
  getFrogsByPartyId,
  getGodByUserId,
  getPendingInvitesForFrog,
  getRecentWorldLog,
  updateEncounter,
  updateFrog,
  updateGod,
} from "./db";
import { getWorldLogEmitter } from "./websockets/worldLogEmitter";

// ─────────────────────────────────────────────
// APP ROUTER
// ─────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  admin: adminRouter,

  // ── AUTH ──────────────────────────────────
  auth: router({
    me: publicProcedure.query(async (opts) => {
      if (!opts.ctx.user) return null;
      const frog = await getFrogByUserId(opts.ctx.user.id);
      const god = await getGodByUserId(opts.ctx.user.id);
      return { ...opts.ctx.user, frog: frog ?? null, god: god ?? null };
    }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    /** Create a Frog character for the current user */
    registerFrog: protectedProcedure
      .input(RegisterFrogSchema)
      .mutation(async ({ ctx, input }) => {
        const existing = await getFrogByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "You already have a Frog character." });
        await createFrog({
          userId: ctx.user.id,
          name: input.characterName,
        });
        return { success: true };
      }),

    /** Create a God profile for the current user */
    registerGod: protectedProcedure
      .input(RegisterGodSchema)
      .mutation(async ({ ctx, input }) => {
        const existing = await getGodByUserId(ctx.user.id);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "You already have a God profile." });
        await createGod({
          userId: ctx.user.id,
          name: input.godName,
        });
        return { success: true };
      }),
  }),

  // ── FROG ──────────────────────────────────
  frog: router({
    myFrog: protectedProcedure.query(async ({ ctx }) => {
      return getFrogByUserId(ctx.user.id) ?? null;
    }),

    getFrogById: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        return getFrogById(input.id) ?? null;
      }),

    getInventory: protectedProcedure.query(async ({ ctx }) => {
      const frog = await getFrogByUserId(ctx.user.id);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "No Frog character found." });
      return getFrogInventory(frog.id);
    }),
  }),

  // ── GOD ───────────────────────────────────
  god: router({
    myGod: protectedProcedure.query(async ({ ctx }) => {
      return getGodByUserId(ctx.user.id) ?? null;
    }),

    /** God intervenes in an active encounter */
    intervene: protectedProcedure
      .input(GodInterventionSchema)
      .mutation(async ({ ctx, input }) => {
        const god = await getGodByUserId(ctx.user.id);
        if (!god) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a God." });

        const INTERVENTION_COST = 20;
        if (god.divinePower < INTERVENTION_COST) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient divine power." });
        }

        const encounter = await getEncounterById(input.encounterId);
        if (!encounter || encounter.status !== "active") {
          throw new TRPCError({ code: "NOT_FOUND", message: "No active encounter found." });
        }

        const enemyData = JSON.parse(encounter.enemyData);
        let message = "";
        let updatedEnemyData = enemyData;

        if (input.interventionType === "HEAL_FROG") {
          const targetId = input.targetFrogId ?? encounter.frogId;
          if (!targetId) throw new TRPCError({ code: "BAD_REQUEST", message: "No frog target." });
          const frog = await getFrogById(targetId);
          if (!frog || frog.isDead) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found or is dead." });

          const healAmount = Math.round(input.magnitude * 1.5);
          const newHp = Math.min(frog.maxHp, frog.hp + healAmount);
          await updateFrog(frog.id, { hp: newHp });
          message = `${god.name} channels divine light — ${frog.name} is healed for ${healAmount} HP!`;

          await createWorldLogEvent({
            encounterId: input.encounterId,
            frogId: frog.id,
            godId: god.id,
            eventType: "HEAL_FROG",
            payload: JSON.stringify({
              encounterId: input.encounterId,
              frogId: frog.id,
              frogName: frog.name,
              godId: god.id,
              godName: god.name,
              eventType: "HEAL_FROG",
              message,
              heal: healAmount,
              timestamp: Date.now(),
            }),
          });

          getWorldLogEmitter().emit("worldEvent", {
            encounterId: input.encounterId,
            frogId: frog.id,
            frogName: frog.name,
            godId: god.id,
            godName: god.name,
            eventType: "HEAL_FROG",
            message,
            heal: healAmount,
            timestamp: Date.now(),
          });
        } else if (input.interventionType === "SMITE_ENEMY") {
          const smiteDamage = Math.round(input.magnitude * 2.5);
          const newEnemyHp = Math.max(0, enemyData.hp - smiteDamage);
          updatedEnemyData = { ...enemyData, hp: newEnemyHp };
          await updateEncounter(encounter.id, { enemyData: JSON.stringify(updatedEnemyData) });
          message = `${god.name} smites ${enemyData.name} with divine wrath for ${smiteDamage} damage!`;

          await createWorldLogEvent({
            encounterId: input.encounterId,
            godId: god.id,
            eventType: "SMITE_ENEMY",
            payload: JSON.stringify({
              encounterId: input.encounterId,
              godId: god.id,
              godName: god.name,
              eventType: "SMITE_ENEMY",
              message,
              damage: smiteDamage,
              timestamp: Date.now(),
            }),
          });

          getWorldLogEmitter().emit("worldEvent", {
            encounterId: input.encounterId,
            godId: god.id,
            godName: god.name,
            eventType: "SMITE_ENEMY",
            message,
            damage: smiteDamage,
            timestamp: Date.now(),
          });
        }

        // Deduct divine power
        await updateGod(god.id, {
          divinePower: god.divinePower - INTERVENTION_COST,
          totalInterventions: god.totalInterventions + 1,
        });

        return { success: true, message };
      }),
  }),

  // ── PARTY ─────────────────────────────────
  party: router({
    create: protectedProcedure
      .input(CreatePartySchema)
      .mutation(async ({ ctx, input }) => {
        const frog = await getFrogByUserId(ctx.user.id);
        if (!frog) throw new TRPCError({ code: "FORBIDDEN", message: "Only Frogs can create parties." });
        if (frog.isDead) throw new TRPCError({ code: "FORBIDDEN", message: "Dead Frogs cannot create parties." });

        const party = await createParty({ name: input.name, leaderId: frog.id });
        await updateFrog(frog.id, { partyId: party.id });
        return party;
      }),

    invite: protectedProcedure
      .input(PartyInviteSchema)
      .mutation(async ({ ctx, input }) => {
        const frog = await getFrogByUserId(ctx.user.id);
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
        const frog = await getFrogByUserId(ctx.user.id);
        if (!frog) throw new TRPCError({ code: "FORBIDDEN", message: "Only Frogs can join parties." });
        if (frog.isDead) throw new TRPCError({ code: "FORBIDDEN", message: "Dead Frogs cannot join parties." });

        const party = await acceptPartyInvite(input.inviteId, frog.id);
        if (!party) throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found or already processed." });
        return party;
      }),

    myParty: protectedProcedure.query(async ({ ctx }) => {
      const frog = await getFrogByUserId(ctx.user.id);
      if (!frog || !frog.partyId) return null;
      const members = await getFrogsByPartyId(frog.partyId);
      return { partyId: frog.partyId, members };
    }),

    pendingInvites: protectedProcedure.query(async ({ ctx }) => {
      const frog = await getFrogByUserId(ctx.user.id);
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
          payload: JSON.parse(e.payload),
        }));
      }),
  }),
});

export type AppRouter = typeof appRouter;
