# Procedural Generation — Frogs & Gods

This document maps every system in the codebase that generates, randomises, or deterministically derives game content.

---

## 1. Overview

Frogs & Gods uses a **narrow, deliberate procedural generation strategy**: the world terrain is fully procedural and deterministic (same seed → same world, always), while items, creatures, and characters are created manually or through player choices.

| System | Procedural? | RNG Type |
|---|---|---|
| World macro layer (Wolfram CA + radial mask) | Yes | Deterministic bit rules |
| World terrain (biome + tile noise) | Yes | Seeded Perlin noise |
| Biome assignment per chunk | Yes | Seeded Perlin noise (offset seed) |
| Lily pad placement (`%`) | Yes | Deterministic hash per tile |
| POI tile stamping | Yes (bake-time) | None — code-defined arrays |
| Chunk seeding script | Yes (orchestration) | None — calls terrain gen |
| Tile definitions | No | Static data |
| God terrain overrides | No | Manual/player-authored |
| Frog character stats | No | Player-distributed |
| Item stats | No | Admin-authored |
| XP curve | No | Deterministic formula |
| Predator placement | No | Manual |

---

## 2. World Generation Pipeline

The pipeline lives in **[server/worldgen/](server/worldgen/)** (7 files). The old entry point `server/utils/worldGenerator.ts` is now a thin backward-compat shim.

```
WORLD_SEED (42)
  │
  ▼
Layer 0 ── MACRO LAYER  [server/worldgen/macroLayer.ts]
  Wolfram Elementary Cellular Automaton on 315×315 chunk grid
  + radial distance mask from center → density threshold
  → binary verdict per chunk: VOID or SOLID
  │
  ├─ VOID → biome = "void", terrainDataJson = null
  │
  └─ SOLID ↓
  │
  ▼
Layer 1 ── BIOME MAPPER  [server/worldgen/biomeMap.ts]
  Low-frequency Perlin (seed+9999, freq 0.015) at chunk coords
  → BiomeDef (name, frequency, water/shore/river thresholds)
  │
  ▼
Layer 2 ── NOISE SAMPLER  [server/worldgen/generator.ts]
  FastNoiseLite Perlin at BiomeDef.frequency
  Sampled at absolute world tile coordinates (no seams across chunks)
  │
  ▼
Layer 3 ── TILE RESOLVER  [server/worldgen/tileResolver.ts]
  noise → "≈" / "+" / "~" / "#" per biome thresholds
  "%" lily pad scattered in deep water via deterministic hash (~2/chunk)
  │
  ▼
Layer 4 ── POI STAMPER  [server/worldgen/poiRegistry.ts]
  stampPois(cx, cy, grid) → overwrites specific tile positions
  │
  ▼
{ grid: string[][] | null, biome: Biome } → DB upsert
```

### Constants

```ts
// server/worldgen/index.ts
export const CHUNK_SIZE    = 16;   // tiles per chunk side
export const WORLD_SEED    = 42;   // global seed
export const WORLD_GRID_SIZE = 315;  // chunks per world axis
export const GRID_RADIUS   = 157;  // chunks from center to edge
export const WOLFRAM_RULE  = 30;   // Wolfram ECA rule number (tunable)
```

---

## 3. Layer 0 — Macro Layer (Wolfram CA + Radial Mask)

**File:** [server/worldgen/macroLayer.ts](server/worldgen/macroLayer.ts)

Runs at seeding time, once per world generation. Determines which chunks are Void (no terrain) vs Solid (proceed to tile generation).

### Wolfram ECA

1. Initialize a row of 315 cells: all 0 except center (col 157) = 1.
2. Run the automaton for 157 steps, producing 158 rows (row 0 = apex, row 157 = most spread out). After each new row, the right half is mirrored to the left half — this forces bilateral symmetry during CA propagation, not just at the end.
3. Assemble the 315×315 grid with vertical mirror around row 157 (the center of the 2D grid):
   - 2D row 157 = CA row 0 (apex — single cell)
   - 2D rows 156..0 = CA rows 1..157 (going up from center)
   - 2D rows 158..314 = mirror of CA rows 1..157 (going down)

The result radiates symmetrically from the world center.

### Radial Mask

```ts
dist = sqrt(cx² + cy²) / sqrt(157² + 157²)  // 0.0 at center, 1.0 at corners
```

### Verdict

```ts
density = ca_value + dist
// density >= 1.0 → SOLID (proceed to tile generation)
// density <  1.0 → VOID  (store biome="void", terrainDataJson=null)
```

The pre-computed `MACRO_GRID` singleton is a `Uint8Array` of 99,225 bytes computed at module load time.

---

## 4. Layer 1 — Biome Mapper

**File:** [server/worldgen/biomeMap.ts](server/worldgen/biomeMap.ts)

```ts
export interface BiomeDef {
  name:            Biome;
  frequency:       number;   // Perlin noise frequency for tile sampling
  waterThreshold:  number;   // noise < this → "≈"
  shoreThreshold:  number;   // noise < this → "+"
  riverThreshold:  number;   // noise < this → "~"
  // noise >= riverThreshold → "#"
}
```

| Biome     | frequency | water | shore | river | character         |
|-----------|-----------|-------|-------|-------|-------------------|
| grassland | 0.08      | 0.10  | 0.30  | 0.40  | mixed             |
| swamp     | 0.06      | 0.30  | 0.50  | 0.60  | mostly wet        |
| forest    | 0.10      | 0.05  | 0.20  | 0.30  | mostly land       |
| desert    | 0.12      | 0.02  | 0.08  | 0.12  | almost all land   |
| mountain  | 0.07      | 0.10  | 0.20  | 0.50  | heavy river bands |
| void      | —         | —     | —     | —     | never generated   |

Biome assignment: a second Perlin noise layer at frequency 0.015 (very low → large regions) is sampled at chunk coordinates. This produces smooth, continent-like biome boundaries.

---

## 5. Layer 3 — Tile Resolver + Lily Pads

**File:** [server/worldgen/tileResolver.ts](server/worldgen/tileResolver.ts)

All biomes use the same 5-character tile set (`≈ + ~ # %`). No new tile characters were introduced — biomes differ only in their water/shore/river thresholds. The `@` character is retired from generation (kept in the schema for backward compat with any pre-overhaul DB rows).

**Lily pad `%` placement** — deterministic hash, ~2 per chunk in deep water only:
```ts
const h = ((worldX * 73856 + worldY * 31337 + seed) % 256 + 256) % 256;
if (noise < biome.waterThreshold && h < 2) return "%";
```
The double-modulo handles JS negative modulo for negative world coordinates.

---

## 6. Layer 4 — POI Stamper

**File:** [server/worldgen/poiRegistry.ts](server/worldgen/poiRegistry.ts)

POIs are TypeScript objects in source code — not DB rows. At seed time, `stampPois()` iterates `POI_REGISTRY` and overwrites specific tiles in the generated grid. After seeding, the chunk is fully self-contained; no POI query is needed at runtime.

```ts
export interface PoiDef {
  id:      string;
  name:    string;
  type:    PoiType;   // "SHRINE" | "DUNGEON" | "RESOURCE_NODE" | "SPAWN_ZONE" | "LANDMARK"
  anchorX: number;    // absolute world tile X
  anchorY: number;    // absolute world tile Y
  tiles?:  Array<{ dx: number; dy: number; char: string }>;
}
```

Changing a POI requires a full reseed (accepted design policy).

---

## 7. World Seeding Script

**File:** [scripts/seedWorld.ts](scripts/seedWorld.ts)

Seeds the full 315×315 = 99,225 chunk world (5040×5040 tiles). Run with:

```bash
npx tsx scripts/seedWorld.ts
npx tsx scripts/seedWorld.ts --dry-run  # count only, no DB writes
```

Key behaviors:
- `MACRO_GRID` is computed once before the loop (module-level const).
- Upserts in batches of 500 chunks — idempotent (safe to re-run).
- Void chunks: `biome = "void"`, `terrainDataJson = null`.
- Logs progress every 5,000 chunks.

---

## 8. Tile Registry

**File:** [shared/tileRegistry.ts](shared/tileRegistry.ts)

```ts
export const TILE_REGISTRY: Record<TileChar, TileDef> = {
  "≈": { char: "≈", label: "Deep Lake", color: "#1a5f8a", movementCost: 5 },
  "+": { char: "+", label: "Shore",     color: "#2a7a5a", movementCost: 3 },
  "~": { char: "~", label: "River",     color: "#1e8870", movementCost: 4 },
  "@": { char: "@", label: "Lily Pad",  color: "#4a7a20", movementCost: 1 },  // legacy
  "#": { char: "#", label: "Land",      color: "#5f9a30", movementCost: 2 },
  "%": { char: "%", label: "Lily Pad",  color: "#4a7a20", movementCost: 1 },  // active
};
```

`@` is kept for backward compat with any pre-overhaul terrain data. `%` is the active lily pad character produced by the new generator.

---

## 9. Terrain Storage

**File:** [drizzle/schema.ts](drizzle/schema.ts) — `worldMapChunks` table

```
worldMapChunks
  id               serial PK
  chunkX           integer  ──┐ unique together
  chunkY           integer  ──┘
  chunkSize        integer     (always 16)
  biome            varchar     ("grassland" | "forest" | "swamp" | "desert" | "mountain" | "void")
  terrainDataJson  text        JSON string of string[][] (null for void chunks)
  isActive         boolean
  entityCount      integer
  lastLoadedAt     timestamp
```

---

## 10. Admin World Inspector

**File:** [client/src/components/admin/WorldInspectorTab.tsx](client/src/components/admin/WorldInspectorTab.tsx)

The Admin "World" tab is a read-only inspector for the baked world:

- **Biome coverage canvas** — 315×315 pixel canvas, 1px per chunk, color-coded by biome. Click a pixel to inspect that chunk.
- **Chunk inspector** — renders the 16×16 ASCII grid of the clicked chunk with tile colors from TILE_REGISTRY.
- **POI registry list** — auto-generated from `POI_REGISTRY` via `admin.getPoiRegistry` tRPC query.

Data sources: `admin.getAllChunkBiomes` (biome canvas), `admin.getChunksByCoords` (chunk inspector), `admin.getPoiRegistry` (POI list).

---

## 11. Terrain Lookup During Gameplay

**File:** [server/engine/movement.ts](server/engine/movement.ts)

Movement validation reads the raw `terrainDataJson` from the DB — no changes needed here. Void chunks have `null` terrain; movement into void chunk coords defaults to the "#" land tile (the existing fallback behavior).

---

## 12. RNG Usage Map

| File | Context | RNG Used |
|---|---|---|
| [server/worldgen/macroLayer.ts](server/worldgen/macroLayer.ts) | Wolfram CA — chunk-level macro grid | Deterministic bit rules (no RNG) |
| [server/worldgen/biomeMap.ts](server/worldgen/biomeMap.ts) | Biome per chunk | `FastNoiseLite` Perlin (seed+9999) |
| [server/worldgen/generator.ts](server/worldgen/generator.ts) | Tile noise per tile | `FastNoiseLite` Perlin (seed) |
| [server/worldgen/tileResolver.ts](server/worldgen/tileResolver.ts) | Lily pad `%` scatter | Deterministic hash |
| [server/routers/admin.ts](server/routers/admin.ts) | Item UUID on spawn | `crypto.randomUUID()` |
| [server/routers/admin.ts](server/routers/admin.ts) | Test user ID generation | `Math.random()` (dev-only) |

---

## 13. Extension Points

### Tune the Wolfram macro pattern
In [server/worldgen/macroLayer.ts](server/worldgen/macroLayer.ts): change `WOLFRAM_RULE` (0–255). Rule 30 produces chaotic, complex patterns; Rule 90 produces a Sierpinski triangle; Rule 110 produces complex structures. Reseed after changing.

### Add or modify biomes
In [server/worldgen/biomeMap.ts](server/worldgen/biomeMap.ts): edit `BIOME_REGISTRY` thresholds and `getBiomeForChunk` noise breakpoints. Reseed to apply.

### Add POIs
In [server/worldgen/poiRegistry.ts](server/worldgen/poiRegistry.ts): add a `PoiDef` to `POI_REGISTRY` with `anchorX/Y` (absolute tile coords) and a `tiles[]` array of offsets. Reseed to bake in.

### Add new tile types
1. Add the char to `TileCharSchema` in [shared/game.schema.ts](shared/game.schema.ts)
2. Add an entry to `TILE_REGISTRY` in [shared/tileRegistry.ts](shared/tileRegistry.ts)
3. Emit the new char from a biome's tile resolver in [server/worldgen/tileResolver.ts](server/worldgen/tileResolver.ts)

### Add procedural item generation
The `spawnItem` mutation in [server/routers/admin.ts](server/routers/admin.ts) is the current item creation path. A weighted rarity table and stat ranges per `rarityTier` (1–12) could be layered on top without schema changes.
