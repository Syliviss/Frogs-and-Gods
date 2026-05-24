# POI Dictionary — Frogs & Gods

The catalog of every Point of Interest type and the complete guide to authoring new ones.
For how the system works end to end, see [POI_SYSTEM.md](POI_SYSTEM.md).

---

## 1. Catalog

Every entry in `POI_TYPE_REGISTRY` ([server/poi/registry.ts](../server/poi/registry.ts)).
This table is the source-of-truth list — update it whenever a POI type is added or changed.

| type | name | biomes | anchor tiles | bordering | requiredOffsets | density | layout | cleanupDelay | startup spawns | startup items |
|---|---|---|---|---|---|---|---|---|---|---|
| `SNAKE_DEN` | Snake Den | any | `#` | `^` (≥1 of 8 neighbors) | — | 0.028 | single `o` at the anchor (white "Snake Den" tile) | 6 | 2 × snake (hp 10, speed 5) at the anchor | — |
| `GOLEM_SANCTUARY` | Golem Sanctuary | any | `#` | — | all 4 diagonal corners must be `#` (no water/peak under any golem) | 0.0005 | single `T` at the anchor (blue "Golem Sanctuary" tile) | 6 | 4 × golem (hp 30, speed 3) at the 4 diagonal corners — perfect square around the anchor | up to 6 × `GOLEM_LOOT` items at the anchor, one per rarity tier 1–6 with steep geometric falloff (0.80 → 0.01) |

---

## 2. What the server / DB expect

### 2.1 `PoiTypeDef` — a POI type in the library

Defined in [server/poi/types.ts](../server/poi/types.ts). Every type in
`POI_TYPE_REGISTRY` is one of these.

| field | type | consumed by | meaning |
|---|---|---|---|
| `type` | string | everywhere | unique key — **must equal** the registry key and `points_of_interest.poiType` |
| `name` | string | docs / Admin UI | human-readable label |
| `eligibleBiomes` | `Biome[]` *(optional)* | bake | a tile is eligible only if its chunk biome is in this list; **omit** to accept any biome |
| `eligibleTiles` | `string[]` | bake | a tile is eligible only if its terrain char is in this list |
| `borderingTiles` | `string[]` *(optional)* | bake | a tile is eligible only if at least one of its 8 in-chunk neighbors has a char in this list; **omit** for no border requirement. Within-chunk only — cross-chunk neighbors are not consulted (absorbed into density tuning) |
| `requiredOffsets` | `RequiredOffset[]` *(optional)* | bake | a tile is eligible only if **every** listed offset matches (sibling to `borderingTiles` — any-one vs. all). Use for footprint constraints, e.g. "all spawn positions must be land." Within-chunk only |
| `density` | number `0..1` | bake | per-eligible-tile probability of becoming a POI (seeded, deterministic) |
| `layout` | `PoiLayoutTile[]` | bake | tile offsets stamped into terrain — see 2.2 |
| `cleanupDelay` | number | POI pass | heartbeats the POI counts down, after a frog leaves, before cleanup. **Must be ≥ 3.** |
| `startup` | `(poi) => PredatorSpawnSpec[]` | POI pass | predators to spawn the first time the POI is triggered |
| `startupItems` | `(poi) => ItemSpawnSpec[]` *(optional)* | POI pass | ground items to offer on first trigger; each spec rolls its own `probability`. Items aren't tracked for cleanup — they persist until a frog picks them up |

### 2.2 `PoiLayoutTile` — one tile of the baked footprint

`{ dx: number, dy: number, char: string }` — offset from the anchor (`dx:0,dy:0`) and the
tile char to stamp. **`char` must be an existing tile char** from
[shared/tileRegistry.ts](../shared/tileRegistry.ts) (`≈ + ~ @ # % D ^`) — the layout is
baked into chunk terrain and renders as ordinary terrain. Layouts may straddle chunk
borders; off-chunk tiles are skipped per chunk during stamping.

### 2.3 `PredatorSpawnSpec` — one predator the startup function spawns

`{ dx, dy, enemyType, speed, hp }`. `dx/dy` are offsets from the anchor. `enemyType` is
`"SNAKE" | "GOLEM"`. The POI pass converts each spec into a `predators` row (snakes get a
2-segment body trailing the head). `aiType` on the DB row is currently **hardcoded** to
`"HUNTER"` in the processor — no AI code branches on it yet. When REACTIVE/DOCILE
behavior is built, reintroduce `aiType` on this interface and thread it through.

### 2.4 `RequiredOffset` — one footprint constraint

`{ dx, dy, chars: string[] }`. Used in `PoiTypeDef.requiredOffsets`: the tile at
`(anchor + dx, anchor + dy)` must have a char in `chars`. **All** listed offsets must
pass or the tile is ineligible. Within-chunk only — an offset that falls outside the
grid is a fail (same edge approximation as `borderingTiles`).

### 2.5 `ItemSpawnSpec` — one ground item the startupItems function offers

`{ dx, dy, name, lootType, rarityTier, statsJson, probability }`. `dx/dy` are offsets
from the anchor. Each spec rolls its own `probability` independently at startup time;
passing specs materialize as `itemState: "GROUND"` items at the offset position.
Spawned items aren't tracked by the POI — they persist on the ground until a frog
picks them up. Useful for loot caches with rarity-based drop tables.

### 2.6 `points_of_interest` row

Created by the world bake. Columns and their baked defaults — see
[POI_SYSTEM.md §2](POI_SYSTEM.md). A new row is written as
`{ poiType, gridX, gridY, chunkX, chunkY }`; `status` (1), `triggered` (false), and
`spawnedPredatorIds` (`[]`) take their defaults.

### 2.7 `status` values — who reads and writes each

| value | written by | read by |
|---|---|---|
| `1` dormant | bake (default); POI pass (after cleanup) | nothing pulls it — dormant |
| `0` woken | frog movement (`wakePoisNear`) | POI pass |
| `-1` active | POI pass (frog confirmed nearby) | POI pass |
| `cleanupDelay` (≥3) | POI pass (frog left) | `decrementDormantPois()` bulk decrement |
| `2` cleanup | `decrementDormantPois()` (counted down from ≥3) | POI pass |

See [POI_SYSTEM.md §3](POI_SYSTEM.md) for the full lifecycle.

---

## 3. How to add a new POI type

1. **Define the type.** Add a `PoiTypeDef` entry to `POI_TYPE_REGISTRY` in
   [server/poi/registry.ts](../server/poi/registry.ts). The object key and `type` field
   must match. Pick `eligibleBiomes` / `eligibleTiles` / `density` for placement, a
   `layout` of existing tile chars, a `cleanupDelay` ≥ 3, and a `startup` function
   returning `PredatorSpawnSpec[]`.
2. **No migration needed.** `poiType` is a varchar — the new type works as soon as the
   registry has it.
3. **Re-bake the world** so the new type is detected and placed:
   `npx tsx scripts/seedWorld.ts`. Existing POI rows are preserved (`onConflictDoNothing`);
   to fully reset, truncate `points_of_interest` first.
4. **Update this file** — add a row to the §1 catalog.
5. If the layout needs a tile char that does not exist yet, add it to `TileChar` in
   [shared/game.schema.ts](../shared/game.schema.ts) and `TILE_REGISTRY` in
   [shared/tileRegistry.ts](../shared/tileRegistry.ts) first (the renderer is data-driven
   off `TILE_REGISTRY`).

### Beyond combat

`startup` returns predator specs; `startupItems` (optional) returns ground-item specs
with independent probability rolls. Together they cover loot caches and guarded shrines.
For other effects (resource nodes, status auras, …) widen the contract further; the
table, the `status` model, the bake, and the heartbeat pass do not change. That is the
intended extension point.

---

## 4. Tuning notes

- **`density`** is per *eligible tile*. A `borderingTiles` or `requiredOffsets`
  constraint shrinks the eligible pool dramatically — e.g. `SNAKE_DEN` (any `#`
  bordering `^`) uses `0.028` to land near ~3000 dens, while the wider all-`#` pool
  needed only `0.0006`; `GOLEM_SANCTUARY` (any `#` with all 4 diagonal corners `#`)
  uses `0.0005` to land near ~1200 sanctuaries. Always re-bake after changing.
- **`cleanupDelay`** is in heartbeats (10s each). `6` ≈ one minute of grace; values up to
  ~8640 give roughly a day. Must stay ≥ 3.
- **`layout`** larger than a few tiles increases cross-chunk stamping work at bake time
  only — no runtime cost.
