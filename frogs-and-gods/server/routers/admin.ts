import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  bulkInsertLoot,
  countLoot,
  createEncounter,
  createFrog,
  createUserWithOpenId,
  createWorldLogEvent,
  getFrogById,
  getGodById,
  getEncounterById,
  grantLootToFrog,
  listAllFrogs,
  listAllGods,
  listAllLoot,
  listAllUsers,
  setUserRole,
  updateEncounter,
  updateFrog,
  updateGod,
} from "../db";
import { processTurn } from "../engine/combatLoop";
import { xpToNextLevel } from "../engine/xpDistributor";
import { CombatMoveSchema, EnemySchema } from "../../shared/game.schema";
import { getWorldLogEmitter } from "../websockets/worldLogEmitter";

// ─────────────────────────────────────────────
// ENEMY TEMPLATES (mirrored from routers.ts)
// ─────────────────────────────────────────────

const ADMIN_ENEMY_TEMPLATES = [
  { id: "swamp-toad",    name: "Swamp Toad",    hp: 60,  maxHp: 60,  attack: 12, defense: 5,  xpReward: 40,  lootTier: 1 },
  { id: "mud-golem",     name: "Mud Golem",     hp: 120, maxHp: 120, attack: 18, defense: 12, xpReward: 80,  lootTier: 3 },
  { id: "bog-wraith",    name: "Bog Wraith",    hp: 90,  maxHp: 90,  attack: 22, defense: 8,  xpReward: 110, lootTier: 4 },
  { id: "elder-serpent", name: "Elder Serpent", hp: 200, maxHp: 200, attack: 30, defense: 18, xpReward: 200, lootTier: 6 },
  { id: "void-herald",   name: "Void Herald",   hp: 350, maxHp: 350, attack: 45, defense: 25, xpReward: 400, lootTier: 9 },
];

function randomAdminEnemy() {
  return ADMIN_ENEMY_TEMPLATES[Math.floor(Math.random() * ADMIN_ENEMY_TEMPLATES.length)]!;
}

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

  // ── ADMIN COMBAT (bypasses user-ownership checks) ─────

  startEncounterAs: publicProcedure
    .input(z.object({
      frogId: z.number().int().positive(),
      enemyId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      if (frog.isDead) throw new TRPCError({ code: "BAD_REQUEST", message: "Dead frogs cannot fight." });

      const enemy = input.enemyId
        ? ADMIN_ENEMY_TEMPLATES.find((e) => e.id === input.enemyId) ?? randomAdminEnemy()
        : randomAdminEnemy();

      const encounter = await createEncounter({
        frogId: frog.id,
        enemyData: JSON.stringify(enemy),
      });

      const logPayload = {
        encounterId: encounter.id,
        frogId: frog.id,
        frogName: frog.name,
        eventType: "ENCOUNTER_START",
        message: `[Admin] ${frog.name} encounters ${enemy.name}!`,
        timestamp: Date.now(),
      };

      await createWorldLogEvent({
        encounterId: encounter.id,
        frogId: frog.id,
        eventType: "ENCOUNTER_START",
        payload: JSON.stringify(logPayload),
      });

      getWorldLogEmitter().emit("worldEvent", logPayload);

      return { encounter, enemy };
    }),

  submitMoveAs: publicProcedure
    .input(CombatMoveSchema)
    .mutation(async ({ input }) => {
      const frog = await getFrogById(input.frogId);
      if (!frog) throw new TRPCError({ code: "NOT_FOUND", message: "Frog not found." });
      if (frog.isDead) throw new TRPCError({ code: "BAD_REQUEST", message: "Dead frogs cannot act." });

      const encounter = await getEncounterById(input.encounterId);
      if (!encounter || encounter.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active encounter found." });
      }

      const enemyData = EnemySchema.parse(JSON.parse(encounter.enemyData));

      const combatant = {
        id: frog.id,
        name: frog.name,
        hp: frog.hp,
        maxHp: frog.maxHp,
        mp: frog.mp,
        maxMp: frog.maxMp,
        attack: frog.attack,
        defense: frog.defense,
        speed: frog.speed,
        level: frog.level,
        xp: frog.xp,
        isDead: frog.isDead,
      };

      const turnResult = processTurn(combatant, enemyData, input.moveType);

      const frogUpdates: Record<string, unknown> = {
        hp: turnResult.updatedFrog.hp,
        mp: turnResult.updatedFrog.mp,
        isDead: turnResult.updatedFrog.isDead,
      };

      if (turnResult.xpResult) {
        const xpGained = turnResult.xpResult.xpAwarded[frog.id] ?? 0;
        frogUpdates.xp = frog.xp + xpGained;
        if (turnResult.xpResult.leveledUp[frog.id]) {
          frogUpdates.level = turnResult.xpResult.newLevel[frog.id];
        }
      }

      await updateFrog(frog.id, frogUpdates as Parameters<typeof updateFrog>[1]);

      await updateEncounter(encounter.id, {
        enemyData: JSON.stringify(turnResult.updatedEnemy),
        status: turnResult.encounterStatus,
        currentTurn: encounter.currentTurn + 1,
      });

      const logPayload = {
        encounterId: encounter.id,
        frogId: frog.id,
        frogName: frog.name,
        eventType: "COMBAT_TURN",
        message: `[Admin] ${turnResult.message}`,
        damage: turnResult.frogAction.damage || undefined,
        xpGained: turnResult.xpResult?.xpAwarded[frog.id],
        lootDropped: turnResult.lootDropped ?? undefined,
        timestamp: Date.now(),
      };

      await createWorldLogEvent({
        encounterId: encounter.id,
        frogId: frog.id,
        eventType: "COMBAT_TURN",
        payload: JSON.stringify(logPayload),
      });

      getWorldLogEmitter().emit("worldEvent", logPayload);

      return {
        turnResult,
        encounter: { ...encounter, status: turnResult.encounterStatus },
      };
    }),
});
