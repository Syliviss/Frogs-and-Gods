# Procedural Generation — Frogs & Gods

This document maps every system in the codebase that generates, randomises, or deterministically derives game content. It covers what is generated, how, and where the code lives.

---

## 1. Overview

Frogs & Gods uses a **narrow, deliberate procedural generation strategy**: the world terrain is fully procedural and deterministic (same seed → same world, always), while items, creatures, and characters are created manually or through player choices. There is no randomised loot, no spawn systems, and no name generation — those are future design spaces.

| System | Procedural? | RNG Type |
|---|---|---|
| World terrain | Yes | Seeded Perlin noise |
| Chunk seeding script | Yes (orchestration) | None — calls terrain gen |
| Tile definitions | No | Static data |
| God terrain overrides | No | Manual/player-authored |
| Frog character stats | No | Player-distributed |
| Item stats | No | Admin-authored |
| XP curve | No | Deterministic formula |
| Predator placement | No | Manual |

---

## 2. World / Terrain Generation

**File:** [server/utils/worldGenerator.ts](server/utils/worldGenerator.ts)

This is the core of all procedural generation in the project. It produces a 16×16 grid of ASCII tile characters for any chunk coordinate pair.

### Constants

```ts
export const CHUNK_SIZE = 16;   // tiles per side
export const WORLD_SEED = 42;   // global seed — change to get a different world
```

### The Noise Pipeline

```
globalSeed (42)
    │
    ▼
FastNoiseLite(globalSeed)
    SetNoiseType: Perlin
    SetFrequency: 0.08
    │
    ▼
GetNoise(worldX, worldY)  ← absolute tile coordinates
    │  returns −1.0 … +1.0
    ▼
normalized = (raw + 1) / 2  ← maps to 0.0 … 1.0
    │
    ▼
tileChar(normalized, localX, localY)
    │  returns one ASCII character
    ▼
string[][] grid (16 rows × 16 columns)
```

The absolute world coordinates passed to `GetNoise` are:
```
worldX = chunkX * CHUNK_SIZE + localX
worldY = chunkY * CHUNK_SIZE + localY
```

This means the noise field is continuous across chunk boundaries — there are no seams.

### Tile Assignment Rules

The `tileChar` function maps the normalized noise value to a tile character:

```ts
function tileChar(n: number, x: number, y: number): string {
  if (n < 0.1) return "≈"; // Deep Lake
  if (n < 0.3) return "+"; // Shore
  if (n < 0.4) return "~"; // River
  return (x + y) % 3 === 0 ? "@" : "#"; // Lily Pad or Land
}
```

| Normalized Value | Extra Condition | Tile | Name |
|---|---|---|---|
| `< 0.1` | — | `≈` | Deep Lake |
| `0.1 – 0.3` | — | `+` | Shore |
| `0.3 – 0.4` | — | `~` | River |
| `≥ 0.4` | `(x + y) % 3 === 0` | `@` | Lily Pad |
| `≥ 0.4` | `(x + y) % 3 !== 0` | `#` | Land |

The Lily Pad / Land split at the land threshold uses a deterministic checkerboard pattern (no RNG) — every third diagonal gets a Lily Pad.

### The `generateChunk` Function

```ts
export function generateChunk(
  chunkX: number,
  chunkY: number,
  globalSeed: number
): string[][]
```

- Creates a new `FastNoiseLite` instance seeded with `globalSeed`
- Iterates over all 256 tiles (16×16)
- Computes absolute world coords per tile
- Returns a `string[][]` — row-major, `grid[y][x]`

Because the seed and noise parameters are fixed constants, `generateChunk` is a **pure function**: identical inputs always produce identical outputs.

---

## 3. World Seeding Script

**File:** [scripts/seedWorld.ts](scripts/seedWorld.ts)

This standalone script is the entry point that populates the database with the initial world. It is run once at setup (or after a db reset) via:

```bash
npx tsx scripts/seedWorld.ts
```

### What It Does

1. Queries the DB for all chunks in the bounding box `(-4, -4)` to `(4, 4)`.
2. Builds a set of already-existing chunk keys (`"cx:cy"`).
3. Iterates over all 81 chunks in the 9×9 grid.
4. Skips any chunk that already exists (idempotent — safe to re-run).
5. Calls `generateChunk(cx, cy, WORLD_SEED)` for missing chunks.
6. Inserts the result into `world_map_chunks` via `createWorldMapChunk()`.

### Storage Format

The `string[][]` from `generateChunk` is serialized as a JSON string and stored in the `terrainDataJson` text column:

```ts
terrainDataJson: JSON.stringify(terrainGrid)
// e.g. '[["#","#","@","~",...], ...]'
```

The `biome` field is set to `"grassland"` for all seeded chunks. The field exists in the schema for future biome-specific generation parameters but is not currently used at runtime.

---

## 4. Terrain Storage (Database Schema)

**File:** [drizzle/schema.ts](drizzle/schema.ts) — `worldMapChunks` table

```
worldMapChunks
  id               serial PK
  chunkX           integer  ──┐ unique together
  chunkY           integer  ──┘
  chunkSize        integer     (always 16)
  biome            varchar     (always "grassland" for now)
  terrainDataJson  text        JSON string of string[][]
  isActive         boolean     (currently unused)
  entityCount      integer     (currently unused)
  lastLoadedAt     timestamp
```

Each chunk occupies one row. The terrain is never recomputed at runtime — it is written once by `seedWorld.ts` and read on demand during movement validation.

---

## 5. Terrain Lookup During Gameplay

**File:** [server/engine/movement.ts](server/engine/movement.ts)

When a frog submits a move, `validateAndQueueMovement` looks up the target tile:

```ts
// Derive chunk from absolute grid position
const chunkX = Math.floor(targetGridX / CHUNK_SIZE);
const chunkY = Math.floor(targetGridY / CHUNK_SIZE);

// Load chunk from DB
const chunks = await getChunksByCoords([{ chunkX, chunkY }]);
const terrain: string[][] = JSON.parse(chunks[0].terrainDataJson);

// Convert absolute coords to local (handles negative coords correctly)
const localX = ((targetGridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
const localY = ((targetGridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

// Read the tile — default to Land if chunk is missing
const targetChar = (terrain[localY]?.[localX] ?? "#") as TileChar;
```

The double-modulo pattern `((n % SIZE) + SIZE) % SIZE` correctly handles negative coordinates (e.g. grid position -1 maps to local index 15).

**File:** [server/engine/tickProcessor.ts](server/engine/tickProcessor.ts) applies the same lookup when resolving pending movement actions on the heartbeat tick.

---

## 6. Tile Registry

**File:** [shared/tileRegistry.ts](shared/tileRegistry.ts)

This is not generative code, but it defines the **runtime meaning** of every tile character the generator can produce. It is the single source of truth used by both the isometric renderer and the movement system.

```ts
export const TILE_REGISTRY: Record<TileChar, TileDef> = {
  "≈": { char: "≈", label: "Deep Lake", color: "#1a5f8a", movementCost: 5 },
  "+": { char: "+", label: "Shore",     color: "#2a7a5a", movementCost: 3 },
  "~": { char: "~", label: "River",     color: "#1e8870", movementCost: 4 },
  "@": { char: "@", label: "Lily Pad",  color: "#4a7a20", movementCost: 1 },
  "#": { char: "#", label: "Land",      color: "#5f9a30", movementCost: 2 },
};
```

Movement cost is the number of movement points consumed to enter that tile. Lily Pads (cost 1) are the fastest tile — thematically ideal for frogs.

---

## 7. God-Authored Terrain Overrides

**File:** [drizzle/schema.ts](drizzle/schema.ts) — `worldMapOverrides` table

Gods (divine-watcher players) can replace individual tiles on the base procedural layer. These overrides are stored separately from the generated terrain:

```
worldMapOverrides
  id           serial PK
  chunkX       integer
  chunkY       integer
  gridX        integer  (absolute world tile X)
  gridY        integer  (absolute world tile Y)
  newChar      varchar  (replacement ASCII tile char)
  authorGodId  integer  (FK to gods)
```

The override system layers on top of `generateChunk` output — at read time, overrides are applied to the base terrain. This preserves the procedural base while allowing divine intervention.

---

## 8. XP / Level Progression

**File:** [server/engine/xpDistributor.ts](server/engine/xpDistributor.ts)

Not terrain generation, but a deterministic mathematical system that governs character growth.

### Level Threshold Formula

```ts
export function xpToNextLevel(level: number): number {
  const BASE = 100;
  const SCALE = 1.5;
  return Math.round(BASE * Math.pow(level, SCALE));
}
```

| Level | XP to next level |
|---|---|
| 1 | 100 |
| 2 | 283 |
| 5 | 1118 |
| 10 | 3162 |
| 20 | 8944 |

Adjusting `BASE` or `SCALE` changes the entire curve.

### Party XP Bonus

```ts
function partyBonus(memberCount: number): number {
  if (memberCount <= 1) return 1.0;
  if (memberCount === 2) return 0.85;
  if (memberCount === 3) return 0.75;
  return 0.65; // 4-player parties
}
```

XP is split equally among living party members after the bonus multiplier is applied. Dead frogs receive no XP.

---

## 9. Frog Character Generation

**Files:** [server/routers.ts](server/routers.ts), [server/routers/admin.ts](server/routers/admin.ts)

Frog stats are not random — they are determined entirely by player choices. The system works as follows:

1. **Player distributes 70 stat points** across 7 attributes: `maxHp`, `maxMana`, `str`, `dex`, `wis`, `int`, `cha`.
2. **Species modifiers** (`SPECIES_MODIFIERS` table) apply +/- deltas to the distributed stats based on the chosen frog species (6 species total).
3. Final stats are written to `frogs.statsJson` as a `FrogStats` JSON object.

There is no RNG in this flow. All variation comes from player decisions.

---

## 10. RNG Usage Map

Every place in the codebase that produces a random value:

| File | Context | RNG Used |
|---|---|---|
| [server/utils/worldGenerator.ts](server/utils/worldGenerator.ts) | Terrain tile per world coordinate | `FastNoiseLite` seeded Perlin |
| [server/routers/admin.ts](server/routers/admin.ts) | Item UUID on spawn | `crypto.randomUUID()` |
| [server/routers/admin.ts](server/routers/admin.ts) | Test user ID generation | `Math.random()` (dev-only) |
| [server/storage.ts](server/storage.ts) | File hash/identifier | `crypto.randomUUID()` |
| [server/seed/seedWorld.ts](server/seed/seedWorld.ts) | Initial item ID | `crypto.randomUUID()` |
| [client/src/components/ui/sidebar.tsx](client/src/components/ui/sidebar.tsx) | React render key | `Math.random()` (UI only, not game logic) |

All game-meaningful RNG flows through `FastNoiseLite`. All other `Math.random()` / `crypto.randomUUID()` calls are for IDs or client UI — they have no effect on game state.

---

## 11. System Flow Diagram

```
                      WORLD GENERATION FLOW
                      ─────────────────────

  WORLD_SEED (42)
       │
       ▼
  FastNoiseLite
  (Perlin, freq 0.08)
       │
       ▼                              ┌─ worldMapChunks table ─┐
  generateChunk(cx, cy, seed)  ──►   │  terrainDataJson: JSON  │
       │  (string[][])                └────────────┬───────────┘
       ▲                                           │
       │                                           │ JSON.parse on demand
  seedWorld.ts                                     ▼
  (81 chunks, idempotent)           movement.ts / tickProcessor.ts
                                           │
                                           │ localX/Y lookup
                                           ▼
                                    targetChar (tile char)
                                           │
                          ┌────────────────┴─────────────────┐
                          ▼                                   ▼
                   TILE_REGISTRY                   movementCost check
                 (label, color, cost)             (validateAndQueueMovement)


                    OVERRIDE LAYER (God Powers)
                    ──────────────────────────

  Base terrain (worldMapChunks)
       │
       + worldMapOverrides (per-tile replacements by Gods)
       │
       ▼
  Final terrain seen by frogs


                    CHARACTER GROWTH FLOW
                    ─────────────────────

  Combat victory
       │  baseXpReward
       ▼
  distributeXp(frogs, baseXpReward)
       │  partyBonus × split per living frog
       ▼
  xpToNextLevel(level)  ← 100 × level^1.5
       │
       ▼
  Level up? → frog.level + 1
```

---

## 12. What Is NOT Procedurally Generated

These systems exist in the schema/code but are manually authored, not generated:

- **Item stats and names** — created explicitly via the `spawnItem` admin mutation
- **Predator placement** — inserted manually; no spawn logic exists yet
- **Loot drops** — no loot table or drop system is implemented
- **Character names** — player-specified at frog creation
- **Quest or dungeon content** — not in the game
- **Biomes** — the `biome` column exists in `worldMapChunks` and is set to `"grassland"` for all chunks; biome-specific generation is not implemented

---

## 13. Extension Points

Where to hook in new procedural systems without disrupting what exists:

### Tune the terrain shape
In [server/utils/worldGenerator.ts](server/utils/worldGenerator.ts):
- Change `WORLD_SEED` to get a completely different world
- Adjust `SetFrequency(0.08)` — lower values produce larger landmasses, higher values produce noisier detail
- Adjust the thresholds in `tileChar` to change the ratio of water to land
- Switch `SetNoiseType` to `Cellular` or `OpenSimplex2` for different terrain character

### Add biome-specific generation
The `biome` column on `worldMapChunks` is already stored. A natural extension would be to:
1. Assign biomes to chunk coordinates during seeding (e.g. based on a second noise layer)
2. Pass the biome into `generateChunk` as a parameter
3. Use different tile thresholds per biome

### Add new tile types
1. Add the new `TileChar` to the union in [shared/game.schema.ts](shared/game.schema.ts)
2. Add an entry to `TILE_REGISTRY` in [shared/tileRegistry.ts](shared/tileRegistry.ts) with color and movement cost
3. Add a threshold branch in `tileChar` in [server/utils/worldGenerator.ts](server/utils/worldGenerator.ts)

### Add procedural item generation
The `spawnItem` mutation in [server/routers/admin.ts](server/routers/admin.ts) is the current item creation path. A weighted rarity table and stat ranges per `rarityTier` (1–12) could be layered on top without changing the schema.

### Add procedural predator spawning
The `predators` table in [drizzle/schema.ts](drizzle/schema.ts) already has `enemyType` (`SNAKE` | `FLY`), `aiType` (`HUNTER` | `REACTIVE` | `DOCILE`), and `statsJson` for flexible AI state. A spawn system would determine spawn locations (e.g. snakes on `#` land tiles, flies over `≈` water) and densities per chunk.
