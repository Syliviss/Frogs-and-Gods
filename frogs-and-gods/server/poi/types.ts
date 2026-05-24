import type { Biome } from "../../shared/game.schema";
import type { PointOfInterest } from "../../drizzle/schema";

// A single tile of a POI's baked layout, expressed as an offset from the anchor.
// `char` must be an existing tile char from shared/tileRegistry.ts — the layout is
// stamped into chunk terrain at bake time and renders as ordinary terrain.
export interface PoiLayoutTile {
  dx:   number;
  dy:   number;
  char: string;
}

// One predator the POI's startup function spawns, positioned relative to the anchor.
export interface PredatorSpawnSpec {
  dx:        number;
  dy:        number;
  enemyType: "SNAKE" | "GOLEM";
  speed:     number;
  hp:        number;
}

// One item the POI's startupItems function offers, positioned relative to the anchor.
// `probability` is rolled independently per spec at startup time — pass to materialize.
export interface ItemSpawnSpec {
  dx:          number;
  dy:          number;
  name:        string;
  lootType:    "NONE" | "SNAKE_LOOT" | "GOLEM_LOOT";
  rarityTier:  number;
  statsJson:   Record<string, unknown>;
  probability: number;
}

// A placement constraint: the tile at (anchor + dx, anchor + dy) must have a char
// in `chars`. ALL entries on PoiTypeDef.requiredOffsets must pass or the tile is
// ineligible. Within-chunk only — same edge approximation as borderingTiles.
export interface RequiredOffset {
  dx:    number;
  dy:    number;
  chars: string[];
}

// Definition of one POI type. Consumed by the world bake (placement + layout) and
// the runtime POI heartbeat pass (startup + cleanupDelay). The registry of these is
// the source of truth for valid `points_of_interest.poiType` values.
export interface PoiTypeDef {
  // Unique key — equals points_of_interest.poiType.
  type: string;
  // Human-readable name for docs and logs.
  name: string;

  // ── Placement (world bake) ──
  // A tile is eligible when: its chunk biome is in eligibleBiomes (if set — omit for any
  // biome), its tile char is in eligibleTiles, and — if borderingTiles is set — at least
  // one of its 8 in-chunk neighbors' chars is in borderingTiles, and — if requiredOffsets
  // is set — every listed offset matches. Each eligible tile then gets a seeded `density`
  // roll.
  eligibleBiomes?:  Biome[];
  eligibleTiles:    string[];
  borderingTiles?:  string[];
  requiredOffsets?: RequiredOffset[];
  // 0..1 — seeded probability that an eligible tile becomes a POI of this type.
  density: number;

  // ── Layout (world bake) ──
  // Tile offsets from the anchor, stamped into chunk terrain. Anchor is dx:0,dy:0.
  layout: PoiLayoutTile[];

  // ── Behavior (runtime POI pass) ──
  // Heartbeats the POI counts down, after a frog leaves, before cleanup runs.
  cleanupDelay: number;
  // Predator-spawn instructions, run once when the POI is first triggered.
  startup: (poi: PointOfInterest) => PredatorSpawnSpec[];
  // Optional item-spawn instructions, run once alongside startup. Each spec rolls its
  // own probability; passing specs materialize as GROUND items at (anchor + dx, anchor + dy).
  // Spawned items are not tracked for cleanup — they persist until a frog picks them up.
  startupItems?: (poi: PointOfInterest) => ItemSpawnSpec[];
}
