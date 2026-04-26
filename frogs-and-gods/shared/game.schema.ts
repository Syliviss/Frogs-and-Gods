import { z } from "zod";

// ─────────────────────────────────────────────
// COMBAT MOVES
// ─────────────────────────────────────────────

export const MoveTypeSchema = z.enum([
  "ATTACK",
  "MAGIC",
  "DEFEND",
  "FLEE",
  "USE_ITEM",
]);
export type MoveType = z.infer<typeof MoveTypeSchema>;

export const CombatMoveSchema = z.object({
  encounterId: z.number().int().positive(),
  frogId: z.number().int().positive(),
  moveType: MoveTypeSchema,
  /** Optional: item id when moveType === "USE_ITEM" */
  itemId: z.number().int().positive().optional(),
  /** Optional: target override (for multi-enemy future expansion) */
  targetId: z.number().int().positive().optional(),
});
export type CombatMove = z.infer<typeof CombatMoveSchema>;

// ─────────────────────────────────────────────
// PARTY INVITES
// ─────────────────────────────────────────────

export const PartyInviteSchema = z.object({
  partyId: z.number().int().positive(),
  invitedFrogId: z.number().int().positive(),
});
export type PartyInviteInput = z.infer<typeof PartyInviteSchema>;

export const JoinPartySchema = z.object({
  inviteId: z.number().int().positive(),
});
export type JoinPartyInput = z.infer<typeof JoinPartySchema>;

export const CreatePartySchema = z.object({
  name: z.string().min(2).max(64),
});
export type CreatePartyInput = z.infer<typeof CreatePartySchema>;

// ─────────────────────────────────────────────
// GOD INTERVENTIONS
// ─────────────────────────────────────────────

export const InterventionTypeSchema = z.enum(["HEAL_FROG", "SMITE_ENEMY"]);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

export const GodInterventionSchema = z.object({
  encounterId: z.number().int().positive(),
  interventionType: InterventionTypeSchema,
  /** Target frog id — required for HEAL_FROG */
  targetFrogId: z.number().int().positive().optional(),
  /** Power magnitude (1–100) */
  magnitude: z.number().int().min(1).max(100).default(25),
});
export type GodIntervention = z.infer<typeof GodInterventionSchema>;

// ─────────────────────────────────────────────
// ENCOUNTER / ENEMY
// ─────────────────────────────────────────────

export const EnemySchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  attack: z.number().int().positive(),
  defense: z.number().int().nonnegative(),
  xpReward: z.number().int().nonnegative(),
  lootTier: z.number().int().min(1).max(12),
});
export type Enemy = z.infer<typeof EnemySchema>;

// ─────────────────────────────────────────────
// WORLD LOG EVENT PAYLOAD
// ─────────────────────────────────────────────

export const WorldLogPayloadSchema = z.object({
  encounterId: z.number().int(),
  frogId: z.number().int().optional(),
  frogName: z.string().optional(),
  godId: z.number().int().optional(),
  godName: z.string().optional(),
  eventType: z.string(),
  message: z.string(),
  damage: z.number().optional(),
  heal: z.number().optional(),
  xpGained: z.number().optional(),
  lootDropped: z.string().optional(),
  timestamp: z.number(),
});
export type WorldLogPayload = z.infer<typeof WorldLogPayloadSchema>;

// ─────────────────────────────────────────────
// REGISTER / PROFILE
// ─────────────────────────────────────────────

export const RegisterFrogSchema = z.object({
  characterName: z.string().min(2).max(64),
});

export const RegisterGodSchema = z.object({
  godName: z.string().min(2).max(64),
});
