import { z } from "zod";

// ─────────────────────────────────────────────
// GOD CREATION
// ─────────────────────────────────────────────

export const DivinePowerIdSchema = z.enum([
  "HEAL_FROG",
  "SMITE_ENEMY",
  "SPAWN_ITEM",
  "SPAWN_PREDATOR",
]);
export type DivinePowerId = z.infer<typeof DivinePowerIdSchema>;

export const CreateGodPayloadSchema = z.object({
  name:           z.string().min(1).max(64),
  startingPowers: z
    .array(DivinePowerIdSchema)
    .length(3, "Exactly 3 starting powers required")
    .refine((arr) => new Set(arr).size === 3, "Starting powers must be unique"),
});
export type CreateGodPayload = z.infer<typeof CreateGodPayloadSchema>;

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

export const SpawnPredatorPayloadSchema = z.object({
  gridX:     z.number().int(),
  gridY:     z.number().int(),
  enemyType: EnemyTypeSchema,
  aiType:    AiTypeSchema,
  speed:     z.number().int().min(1).max(10).default(5),
  hp:        z.number().int().min(1).max(100).default(20),
});
export type SpawnPredatorPayload = z.infer<typeof SpawnPredatorPayloadSchema>;

export const KillPredatorPayloadSchema = z.object({
  predatorId: z.number().int().positive(),
});
export type KillPredatorPayload = z.infer<typeof KillPredatorPayloadSchema>;

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

export const TileCharSchema = z.enum(["≈", "+", "~", "@", "#", "%", "D"]);
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

// ─────────────────────────────────────────────
// ACTION SCHEMA (server-driven item targeting)
// ─────────────────────────────────────────────

export const TargetingSchema = z.object({
  /** Only TILE_SELECT is currently implemented */
  type:               z.literal("TILE_SELECT"),
  /** Number of tiles the player must select before the action auto-submits */
  count:              z.number().int().positive(),
  /** Each selected tile must be within max_range (Chebyshev) of the frog */
  adjacency_required: z.boolean(),
  /** Maximum Chebyshev distance from frog to each selected tile */
  max_range:          z.number().int().nonnegative(),
});

export const ActionSchemaSchema = z.object({
  /** Must match the ACTION_REGISTRY key on the server (e.g. "SWING") */
  action_name:  z.string().min(1),
  targeting:    TargetingSchema,
  /** How long this action takes to resolve after submission, in milliseconds.
   *  Server converts to sub-ticks: ceil(cast_time_ms / 500). */
  cast_time_ms: z.number().int().nonnegative(),
});
export type ActionSchema = z.infer<typeof ActionSchemaSchema>;

export const ItemStatsSchema = z.object({
  attackBonus:    z.number().int().optional(),
  defenseBonus:   z.number().int().optional(),
  hpBonus:        z.number().int().optional(),
  /** Actions this item grants when EQUIPPED */
  grantedActions: z.array(z.string()).optional(),
  /** Actions this item blocks (triggers Fumble) while in frog's inventory */
  blockedActions: z.array(z.string()).optional(),
  visionModifier: z.number().int().optional(),
  /** Targeting + cast parameters for the action this item grants.
   *  When present, the frontend enters targeting mode instead of acting immediately. */
  actionSchema:   ActionSchemaSchema.optional(),
});
export type ItemStats = z.infer<typeof ItemStatsSchema>;

export const ItemStateSchema = z.enum(["VOID", "GROUND", "INVENTORY", "EQUIPPED", "ITEM", "GOD"]);
export type ItemState = z.infer<typeof ItemStateSchema>;

export const ItemTypeSchema = z.enum(["STANDARD", "CONTAINER"]);
export type ItemType = z.infer<typeof ItemTypeSchema>;

export const SpawnItemSchema = z.object({
  name:       z.string().min(1).max(128),
  rarityTier: z.number().int().min(1).max(12),
  stats:      ItemStatsSchema,
  itemState:  ItemStateSchema.default("GROUND"),
  itemType:   ItemTypeSchema.default("STANDARD"),
  ownerId:    z.number().int().positive().nullable().default(null),
  /** Tile position — populated when itemState = "GROUND" */
  gridX:      z.number().int().optional(),
  gridY:      z.number().int().optional(),
});
export type SpawnItemInput = z.infer<typeof SpawnItemSchema>;

// ─────────────────────────────────────────────
// GOD / ADMIN ACTION PAYLOAD SCHEMAS
// ─────────────────────────────────────────────

export const CreateItemPayloadSchema = z.object({
  name:        z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  statsJson:   ItemStatsSchema,
  pixelData:   z.array(z.string().nullable()).length(256).optional(),
  itemType:    ItemTypeSchema.default("STANDARD"),
  rarityTier:  z.number().int().min(1).max(12).default(1),
});
export type CreateItemPayload = z.infer<typeof CreateItemPayloadSchema>;

export const SpawnItemPayloadSchema = z.object({
  itemId:  z.string().uuid(),
  targetX: z.number().int(),
  targetY: z.number().int(),
});
export type SpawnItemPayload = z.infer<typeof SpawnItemPayloadSchema>;

// ─────────────────────────────────────────────
// ITEM PIXEL DATA (sprite cache lazy-fetch)
// ─────────────────────────────────────────────

export const PixelDataSchema = z.array(z.string().nullable()).length(256);
export type PixelData = z.infer<typeof PixelDataSchema>;

export const ItemPixelDataSchema = z.object({
  itemId:    z.string(),
  pixelData: PixelDataSchema.nullable(),
});
export type ItemPixelData = z.infer<typeof ItemPixelDataSchema>;

// ─────────────────────────────────────────────
// ITEM ACTION SCHEMAS
// ─────────────────────────────────────────────

export const EquipActionSchema = z.object({
  itemId: z.string().min(1).max(36),
});
export type EquipActionInput = z.infer<typeof EquipActionSchema>;

export const ThrowActionSchema = z.object({
  itemId:      z.string().min(1).max(36),
  targetGridX: z.number().int(),
  targetGridY: z.number().int(),
});
export type ThrowActionInput = z.infer<typeof ThrowActionSchema>;

export const StoreActionSchema = z.object({
  itemId:      z.string().min(1).max(36),
  containerId: z.string().min(1).max(36),
});
export type StoreActionInput = z.infer<typeof StoreActionSchema>;

export const GiveActionSchema = z.object({
  itemId: z.string().min(1).max(36),
});
export type GiveActionInput = z.infer<typeof GiveActionSchema>;

export const PickupActionSchema = z.object({
  itemId: z.string().min(1).max(36),
});
export type PickupActionInput = z.infer<typeof PickupActionSchema>;

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

// ─────────────────────────────────────────────
// ACTION LOG (ephemeral sub-tick events)
// ─────────────────────────────────────────────

export type ActionLogCategory = "movement" | "combat" | "god";

export interface ActionLogEntry {
  text:     string;
  x:        number;
  y:        number;
  chunk_id: string;
  category: ActionLogCategory;
}

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

// ─────────────────────────────────────────────
// GOD VISION (free-camera admin viewport)
// ─────────────────────────────────────────────

export const GetGodVisionSchema = z.object({
  centerChunkX: z.number().int().min(-312).max(312),
  centerChunkY: z.number().int().min(-312).max(312),
});
export type GetGodVisionInput = z.infer<typeof GetGodVisionSchema>;

// ─────────────────────────────────────────────
// MAP STUDIO (large-canvas screenshot renderer)
// ─────────────────────────────────────────────

export const GetMapStudioChunksSchema = z.object({
  centerChunkX: z.number().int().min(-312).max(312),
  centerChunkY: z.number().int().min(-312).max(312),
  radius: z.number().int().min(1).max(5),
});
export type GetMapStudioChunksInput = z.infer<typeof GetMapStudioChunksSchema>;

export const SubmitDivineActionSchema = z.object({
  godId:               z.number().int().positive(),
  powerId:             DivinePowerIdSchema,
  targetGridX:         z.number().int().optional(),
  targetGridY:         z.number().int().optional(),
  targetFrogId:        z.number().int().positive().optional(),
  targetPredatorId:    z.number().int().positive().optional(),
  // SPAWN_ITEM extras
  spawnItemTemplateId: z.string().uuid().optional(),
  // SPAWN_PREDATOR extras
  spawnEnemyType:      EnemyTypeSchema.optional(),
  spawnEnemyAiType:    AiTypeSchema.optional(),
  spawnEnemyHp:        z.number().int().min(1).max(500).optional(),
  spawnEnemySpeed:     z.number().int().min(1).max(10).optional(),
});
export type SubmitDivineActionInput = z.infer<typeof SubmitDivineActionSchema>;

export const GodPanSchema = z.object({
  godId:  z.number().int().positive(),
  chunkX: z.number().int().min(-312).max(312),
  chunkY: z.number().int().min(-312).max(312),
});
export type GodPanInput = z.infer<typeof GodPanSchema>;
