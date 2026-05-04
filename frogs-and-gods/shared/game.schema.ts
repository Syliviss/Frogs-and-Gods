import { z } from "zod";

// ─────────────────────────────────────────────
// PARTY INVITES
// ─────────────────────────────────────────────

export const PartyInviteSchema = z.object({
  partyId:       z.number().int().positive(),
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
  chunkX:           z.number().int().min(-312).max(312),
  chunkY:           z.number().int().min(-312).max(312),
  interventionType: InterventionTypeSchema,
  /** Target frog id — required for HEAL_FROG */
  targetFrogId:     z.number().int().positive().optional(),
  /** Power magnitude (1–100) */
  magnitude:        z.number().int().min(1).max(100).default(25),
});
export type GodIntervention = z.infer<typeof GodInterventionSchema>;

// ─────────────────────────────────────────────
// ENEMY / PREDATOR
// ─────────────────────────────────────────────

export const EnemyTypeSchema   = z.enum(["SNAKE", "FLY"]);
export const AiTypeSchema      = z.enum(["HUNTER", "REACTIVE", "DOCILE"]);

export const PredatorSchema = z.object({
  enemyType:  EnemyTypeSchema,
  aiType:     AiTypeSchema,
  gridX:      z.number().int(),
  gridY:      z.number().int(),
  currentHp:  z.number().int().positive(),
});
export type PredatorInput = z.infer<typeof PredatorSchema>;

// ─────────────────────────────────────────────
// WORLD LOG EVENT PAYLOAD
// ─────────────────────────────────────────────

export const WorldLogPayloadSchema = z.object({
  encounterId: z.number().int().optional(),
  frogId:      z.number().int().optional(),
  frogName:    z.string().optional(),
  godId:       z.number().int().optional(),
  godName:     z.string().optional(),
  eventType:   z.string(),
  message:     z.string(),
  damage:      z.number().optional(),
  heal:        z.number().optional(),
  xpGained:    z.number().optional(),
  lootDropped: z.string().optional(),
  chunkX:      z.number().int().optional(),
  chunkY:      z.number().int().optional(),
  tickId:      z.number().int().optional(),
  timestamp:   z.number(),
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
// FROG CREATION — SPECIES & STAT DISTRIBUTION
// ─────────────────────────────────────────────

export const FrogSpeciesSchema = z.enum([
  "BULL_FROG",
  "TREE_FROG",
  "SHAMEN_FROG",
  "OLD_FROG",
  "GUIRO_FROG",
  "POISON_DART_FROG",
]);
export type FrogSpecies = z.infer<typeof FrogSpeciesSchema>;

export const FrogStatsDistributionSchema = z.object({
  maxHp:   z.number().int().min(1),
  maxMana: z.number().int().min(1),
  str:     z.number().int().min(1),
  dex:     z.number().int().min(1),
  wis:     z.number().int().min(1),
  int:     z.number().int().min(1),
  cha:     z.number().int().min(1),
});
export type FrogStatsDistribution = z.infer<typeof FrogStatsDistributionSchema>;

export const CreateFrogSchema = z.object({
  name:             z.string().min(2).max(64),
  species:          FrogSpeciesSchema,
  distributedStats: FrogStatsDistributionSchema,
}).refine(
  (d) => Object.values(d.distributedStats).reduce((a, b) => a + b, 0) === 70,
  { message: "Distributed stats must sum to exactly 70", path: ["distributedStats"] }
);
export type CreateFrogInput = z.infer<typeof CreateFrogSchema>;

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
// WORLD MAP OVERRIDES
// ─────────────────────────────────────────────

export const WorldMapOverrideSchema = z.object({
  chunkX:      z.number().int().min(-312).max(312),
  chunkY:      z.number().int().min(-312).max(312),
  gridX:       z.number().int(),
  gridY:       z.number().int(),
  newChar:     z.string().max(4),
  authorGodId: z.number().int().positive().optional(),
});
export type WorldMapOverrideInput = z.infer<typeof WorldMapOverrideSchema>;

// ─────────────────────────────────────────────
// ITEMS (vault — 1-of-1)
// ─────────────────────────────────────────────

export const ItemStatsSchema = z.object({
  attackBonus:    z.number().int().optional(),
  defenseBonus:   z.number().int().optional(),
  hpBonus:        z.number().int().optional(),
  /** Unique action this item grants (e.g. "ACTION_DEVOUR") */
  actionType:     z.string().optional(),
  visionModifier: z.number().int().optional(),
});
export type ItemStats = z.infer<typeof ItemStatsSchema>;

export const OwnerTypeSchema = z.enum(["frog", "god", "world_drop", "void"]);

export const SpawnItemSchema = z.object({
  name:       z.string().min(1).max(128),
  rarityTier: z.number().int().min(1).max(12),
  stats:      ItemStatsSchema,
  ownerType:  OwnerTypeSchema.default("world_drop"),
  ownerId:    z.number().int().positive().nullable().default(null),
  /** Tile position — populated when ownerType = "world_drop" */
  gridX:      z.number().int().optional(),
  gridY:      z.number().int().optional(),
});
export type SpawnItemInput = z.infer<typeof SpawnItemSchema>;

// ─────────────────────────────────────────────
// PENDING ACTION (heartbeat queue input)
// ─────────────────────────────────────────────

export const PendingActionSchema = z.object({
  type:    z.string().min(1),
  payload: z.unknown(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const SubmitActionSchema = z.object({
  actionType:  z.string().min(1).max(64),
  targetGridX: z.number().int().optional(),
  targetGridY: z.number().int().optional(),
  payload:     z.record(z.string(), z.unknown()).optional(),
});
export type SubmitActionInput = z.infer<typeof SubmitActionSchema>;

// ─────────────────────────────────────────────
// MOVEMENT ACTION (tRPC queue path)
// ─────────────────────────────────────────────

export const MoveTypeSchema = z.enum(["STEP", "HOP", "DASH"]);
export type MoveActionType = z.infer<typeof MoveTypeSchema>;

export const MoveActionSchema = z.object({
  actionType:  MoveTypeSchema,
  targetGridX: z.number().int(),
  targetGridY: z.number().int(),
});
export type MoveActionInput = z.infer<typeof MoveActionSchema>;

// ─────────────────────────────────────────────
// PLAYER VISION
// ─────────────────────────────────────────────

export const GetPlayerVisionSchema = z.object({
  frogId: z.number().int().positive(),
});
export type GetPlayerVisionInput = z.infer<typeof GetPlayerVisionSchema>;
