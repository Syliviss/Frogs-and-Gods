import { z } from "zod";

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

// ─────────────────────────────────────────────
// WORLD MAP CHUNKS
// ─────────────────────────────────────────────

export const BiomeSchema = z.enum([
  "grassland", "forest", "swamp", "desert", "mountain", "void",
]);
export type Biome = z.infer<typeof BiomeSchema>;

export const SpawnChunkSchema = z.object({
  chunkX:    z.number().int().min(-312).max(312),
  chunkY:    z.number().int().min(-312).max(312),
  biome:     BiomeSchema.default("grassland"),
  chunkSize: z.number().int().positive().default(16),
});
export type SpawnChunkInput = z.infer<typeof SpawnChunkSchema>;

export const TileCharSchema = z.enum(["≈", "+", "~", "@", "#"]);
export type TileChar = z.infer<typeof TileCharSchema>;

export const WorldMapChunkSchema = z.object({
  id:              z.number().int().positive(),
  chunkX:          z.number().int().min(-312).max(312),
  chunkY:          z.number().int().min(-312).max(312),
  terrainDataJson: z.string().nullable(),
  overridesJson:   z.string().nullable(),
});
export type WorldMapChunkData = z.infer<typeof WorldMapChunkSchema>;

export const GenerateChunkSchema = z.object({
  chunkX:     z.number().int().min(-312).max(312),
  chunkY:     z.number().int().min(-312).max(312),
  globalSeed: z.number().int(),
});
export type GenerateChunkInput = z.infer<typeof GenerateChunkSchema>;

export const GetChunksByCoordsSchema = z.object({
  coords: z.array(
    z.object({
      chunkX: z.number().int().min(-312).max(312),
      chunkY: z.number().int().min(-312).max(312),
    })
  ).min(1).max(9),
});
export type GetChunksByCoordsInput = z.infer<typeof GetChunksByCoordsSchema>;

// ─────────────────────────────────────────────
// 1-OF-1 ITEMS
// ─────────────────────────────────────────────

export const ItemStatsSchema = z.object({
  attackBonus:    z.number().int().default(0),
  defenseBonus:   z.number().int().default(0),
  hpBonus:        z.number().int().default(0),
  mpBonus:        z.number().int().default(0),
  specialAbility: z.string().optional(),
});
export type ItemStats = z.infer<typeof ItemStatsSchema>;

export const OwnerTypeSchema = z.enum(["frog", "god", "world_drop", "void"]);

export const SpawnItemSchema = z.object({
  name:            z.string().min(1).max(128),
  rarityTier:      z.number().int().min(1).max(12),
  stats:           ItemStatsSchema,
  ownerType:       OwnerTypeSchema.default("world_drop"),
  ownerId:         z.number().int().positive().nullable().default(null),
  locationDropped: z.string().max(128).nullable().optional(),
});
export type SpawnItemInput = z.infer<typeof SpawnItemSchema>;
