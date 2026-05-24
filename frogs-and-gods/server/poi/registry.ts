import type { PoiTypeDef } from "./types";

// All POI type definitions, keyed by `type`. This object is the source of truth for
// valid `points_of_interest.poiType` values. To add a POI type, add an entry here —
// no schema migration is needed (poiType is a varchar).
export const POI_TYPE_REGISTRY: Record<string, PoiTypeDef> = {
  SNAKE_DEN: {
    type: "SNAKE_DEN",
    name: "Snake Den",
    // eligibleBiomes omitted → any biome qualifies.
    eligibleTiles:  ["#"],
    borderingTiles: ["^"],  // anchor must have at least one in-chunk peak neighbor
    density:        0.028,  // tuned via dry-run to land near ~2956 dens worldwide
    layout: [
      { dx: 0, dy: 0, char: "o" },  // single white marker
    ],
    cleanupDelay: 6,
    // Snakes emerge from the den tile itself — guaranteed walkable ground.
    startup: () => [
      { dx: 0, dy: 0, enemyType: "SNAKE", speed: 5, hp: 10 },
      { dx: 0, dy: 0, enemyType: "SNAKE", speed: 5, hp: 10 },
    ],
  },

  GOLEM_SANCTUARY: {
    type: "GOLEM_SANCTUARY",
    name: "Golem Sanctuary",
    // eligibleBiomes omitted → any biome qualifies.
    eligibleTiles:   ["#"],
    // All 4 corners of the golem square must be clear land — no golem on water or peak.
    requiredOffsets: [
      { dx: -1, dy: -1, chars: ["#"] },
      { dx:  1, dy: -1, chars: ["#"] },
      { dx: -1, dy:  1, chars: ["#"] },
      { dx:  1, dy:  1, chars: ["#"] },
    ],
    density: 0.0005,  // tuned via dry-run to land near ~1200 sanctuaries worldwide
    layout: [
      { dx: 0, dy: 0, char: "T" },  // single blue marker, anchor at center of the square
    ],
    cleanupDelay: 6,
    startup: () => [
      { dx: -1, dy: -1, enemyType: "GOLEM", speed: 3, hp: 30 },
      { dx:  1, dy: -1, enemyType: "GOLEM", speed: 3, hp: 30 },
      { dx: -1, dy:  1, enemyType: "GOLEM", speed: 3, hp: 30 },
      { dx:  1, dy:  1, enemyType: "GOLEM", speed: 3, hp: 30 },
    ],
    // Independent rolls per rarity tier — steep geometric falloff.
    startupItems: () => [
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 1, statsJson: {}, probability: 0.80 },
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 2, statsJson: {}, probability: 0.50 },
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 3, statsJson: {}, probability: 0.25 },
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 4, statsJson: {}, probability: 0.10 },
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 5, statsJson: {}, probability: 0.04 },
      { dx: 0, dy: 0, name: "Golem Loot", lootType: "GOLEM_LOOT", rarityTier: 6, statsJson: {}, probability: 0.01 },
    ],
  },
};

export function getPoiTypeDef(type: string): PoiTypeDef | undefined {
  return POI_TYPE_REGISTRY[type];
}
