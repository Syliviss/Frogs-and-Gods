import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  bulkInsertLoot,
  countLoot,
  createFrog,
  createUserWithOpenId,
  getFrogById,
  getGodById,
  grantLootToFrog,
  listAllFrogs,
  listAllGods,
  listAllLoot,
  listAllUsers,
  setUserRole,
  updateFrog,
  updateGod,
} from "../db";

// ─────────────────────────────────────────────
// LOOT SEED DATA — 12 rarity tiers
// ─────────────────────────────────────────────

const LOOT_SEED = [
  { tier: 1,  rarityLabel: "Common",              name: "Mud-Worn Stick",          attackBonus: 1,  defenseBonus: 0,  hpBonus: 0,   mpBonus: 0,  dropRate: 0.80 },
  { tier: 2,  rarityLabel: "Uncommon",             name: "Pond-Stone Buckler",      attackBonus: 0,  defenseBonus: 2,  hpBonus: 5,   mpBonus: 0,  dropRate: 0.55 },
  { tier: 3,  rarityLabel: "Rare",                 name: "Bogwood Blade",           attackBonus: 4,  defenseBonus: 1,  hpBonus: 0,   mpBonus: 0,  dropRate: 0.35 },
  { tier: 4,  rarityLabel: "Epic",                 name: "Swamp Sapphire Amulet",   attackBonus: 2,  defenseBonus: 3,  hpBonus: 15,  mpBonus: 5,  dropRate: 0.22 },
  { tier: 5,  rarityLabel: "Legendary",            name: "Thornfang Dagger",        attackBonus: 8,  defenseBonus: 2,  hpBonus: 0,   mpBonus: 10, dropRate: 0.13 },
  { tier: 6,  rarityLabel: "Mythic",               name: "Gilded Frog Crown",       attackBonus: 5,  defenseBonus: 5,  hpBonus: 20,  mpBonus: 20, dropRate: 0.08 },
  { tier: 7,  rarityLabel: "Celestial",            name: "Starwoven Mantle",        attackBonus: 10, defenseBonus: 8,  hpBonus: 30,  mpBonus: 15, dropRate: 0.05 },
  { tier: 8,  rarityLabel: "Abyssal",              name: "Void-Touched Greaves",    attackBonus: 7,  defenseBonus: 12, hpBonus: 25,  mpBonus: 0,  dropRate: 0.03 },
  { tier: 9,  rarityLabel: "Divine",               name: "Herald's Blessed Spear",  attackBonus: 18, defenseBonus: 6,  hpBonus: 10,  mpBonus: 30, dropRate: 0.02 },
  { tier: 10, rarityLabel: "Transcendent",         name: "Rift Crystal Staff",      attackBonus: 15, defenseBonus: 10, hpBonus: 40,  mpBonus: 40, dropRate: 0.01 },
  { tier: 11, rarityLabel: "Primordial",           name: "Primordial Fang",         attackBonus: 25, defenseBonus: 15, hpBonus: 50,  mpBonus: 25, dropRate: 0.005 },
  { tier: 12, rarityLabel: "Mythic Transcendent",  name: "Tongue of the First God",  attackBonus: 40, defenseBonus: 25, hpBonus: 100, mpBonus: 50, dropRate: 0.001 },
];

function xpToNextLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

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
      role: z.enum(["frog", "god", "admin"]),
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
    .input(z.object({ name: z.string().min(2).max(64) }))
    .mutation(async ({ input }) => {
      const openId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userId = await createUserWithOpenId(openId, `TestUser_${input.name}`);
      await createFrog({ userId, name: input.name });
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

      let newXp = frog.xp + input.amount;
      let newLevel = frog.level;
      let leveled = false;

      while (newXp >= xpToNextLevel(newLevel)) {
        newXp -= xpToNextLevel(newLevel);
        newLevel++;
        leveled = true;
      }

      await updateFrog(frog.id, {
        xp: newXp,
        level: newLevel,
        xpToNextLevel: xpToNextLevel(newLevel),
      });

      return { success: true, leveled, newLevel, newXp };
    }),

  resurrectFrog: publicProcedure
    .input(z.object({ frogId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      await updateFrog(frog.id, { isDead: false, hp: frog.maxHp, mp: frog.maxMp });
      return { success: true };
    }),

  // ── GODS ──────────────────────────────────

  listGods: publicProcedure.query(async () => {
    return listAllGods();
  }),

  setDivinePower: publicProcedure
    .input(z.object({
      godId: z.number().int().positive(),
      amount: z.number().int().min(0).max(10_000),
    }))
    .mutation(async ({ input }) => {
      const god = await getGodById(input.godId);
      if (!god) throw new TRPCError({ code: "NOT_FOUND", message: "God not found." });
      await updateGod(god.id, { divinePower: input.amount });
      return { success: true };
    }),

  // ── LOOT ──────────────────────────────────

  listLoot: publicProcedure.query(async () => {
    return listAllLoot();
  }),

  seedLoot: publicProcedure.mutation(async () => {
    const existing = await countLoot();
    if (existing > 0) {
      return { success: false, message: `Loot table already has ${existing} items. Clear it first.` };
    }
    await bulkInsertLoot(LOOT_SEED);
    return { success: true, message: `Seeded ${LOOT_SEED.length} loot items.` };
  }),

  grantLoot: publicProcedure
    .input(z.object({
      frogId: z.number().int().positive(),
      lootId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      await grantLootToFrog(input.frogId, input.lootId);
      return { success: true };
    }),

});
