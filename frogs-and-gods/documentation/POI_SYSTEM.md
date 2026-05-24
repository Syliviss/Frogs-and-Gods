# POI System — Frogs & Gods

Points of Interest (POIs) are procedurally-placed, **stateful** locations baked into the
world. The first use is **combat ambush encounters**: a frog wanders near a baked POI, it
spawns predators; the frog leaves, a grace period elapses, the predators are cleaned up and
the POI resets to dormant. The POI *library* is generic so non-combat POI types can be
added later without a schema migration.

For the catalog of POI types and a step-by-step authoring guide, see
[POI_DICTIONARY.md](POI_DICTIONARY.md).

---

## 1. Data path overview

```
WORLD BAKE (scripts/seedWorld.ts, pre-launch)
  Pass 1  detect POIs per chunk (rules + seeded density roll)
  Pass 2  regenerate chunks, stamp POI layouts into terrain, persist chunks
  Pass 3  insert points_of_interest rows (status = 1 dormant)
        │
        ▼
RUNTIME (every 10s heartbeat)
  subticks   frog movement actions load POIs into SimulatedState and, after
             moving, wake POIs in the new 3×3 chunk neighborhood (status → 0)
        │
  broadcast  runPoiHeartbeatPass() — inhale active POIs, run startup/cleanup,
             commit predators + POI updates — THEN ENGINE_TICK is broadcast
        │
        ▼
  clients refetch vision → frog move + spawned predators land in one refresh
```

---

## 2. The `points_of_interest` table

Defined in [drizzle/schema.ts](../drizzle/schema.ts). Follows the `predators` convention:
absolute `gridX/gridY` plus denormalized `chunkX/chunkY`.

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `poiType` | varchar(64) | library type key — see `POI_TYPE_REGISTRY` |
| `gridX`, `gridY` | integer | absolute anchor tile |
| `chunkX`, `chunkY` | integer | denormalized `floor(grid / 16)` |
| `status` | integer, default `1` | lifecycle countdown — see §3 |
| `triggered` | boolean, default `false` | true once startup has run |
| `spawnedPredatorIds` | jsonb `number[]`, default `[]` | predators this POI spawned |
| `instanceId` | integer, nullable | always null in v1 (POIs are overworld-only) |
| `createdAt` / `updatedAt` | timestamp | standard |

Indexes: `unique_poi_pos` on `(gridX, gridY)` — one POI per tile; `idx_poi_chunk` on
`(chunkX, chunkY)`; `idx_poi_status` on `(status)`.

---

## 3. The `status` countdown model

`status` is a single integer. `0` = active. The POI heartbeat pass pulls only
`status IN (-1, 0, 2)`; the rest are bulk-decremented or left alone — so dormant POIs cost
nothing.

| `status` | meaning | pulled by the POI pass? | processing |
|---|---|---|---|
| **-1** | ACTIVE — frog confirmed nearby | yes | run startup if `!triggered`; scan 3×3 chunk neighborhood — frog present → stay `-1`; no frog → `status = cleanupDelay` |
| **0** | WOKEN — set by frog movement | yes | same scan as `-1`; frog present → `-1` (+ startup); no frog → `status = cleanupDelay` |
| **≥3** | grace countdown | **no** — bulk `UPDATE … status = status-1 WHERE status >= 3` | — |
| **2** | CLEANUP | yes | delete `spawnedPredatorIds`, `triggered = false`, `status = 1` |
| **1** | DORMANT — resting state | **no** | — |

**Lifecycle:** baked at `1` → a frog moves nearby, movement sets it to `0` → the POI pass's
`0`-scan finds the frog → `-1`, startup spawns predators → frog leaves, a scan finds no
frog → `status = cleanupDelay` → bulk-decrements each heartbeat → reaches `2`, cleanup
removes the predators → `1`, dormant again.

Because the `-1` state re-scans the neighborhood every heartbeat, a frog standing still
still keeps the encounter alive — there is no stationary-frog edge case.

---

## 4. POI library — `server/poi/`

| file | purpose |
|---|---|
| [types.ts](../server/poi/types.ts) | `PoiTypeDef`, `PoiLayoutTile`, `PredatorSpawnSpec`, `ItemSpawnSpec`, `RequiredOffset` interfaces |
| [registry.ts](../server/poi/registry.ts) | `POI_TYPE_REGISTRY` — all POI type definitions; `getPoiTypeDef()` |
| [worldgen.ts](../server/poi/worldgen.ts) | `detectPois()` + `stampPoiLayouts()` — bake-time placement & stamping |
| [processor.ts](../server/poi/processor.ts) | `runPoiHeartbeatPass()` — the runtime heartbeat pass |

`POI_TYPE_REGISTRY` is the source of truth for valid `poiType` values. `poiType` is a
varchar (not a pg enum) so adding a type needs no migration. A POI row whose `poiType` has
no matching `PoiTypeDef` is skipped by the pass with a console warning.

---

## 5. World-bake integration

The bake is [scripts/seedWorld.ts](../scripts/seedWorld.ts). `generateChunk()`
([server/worldgen/generator.ts](../server/worldgen/generator.ts)) now produces **pure
terrain** — POI stamping was removed from it. The bake runs three passes:

1. **Detect** — for every solid chunk, `detectPois()` evaluates each tile: chunk biome ∈
   `eligibleBiomes` (if set), tile char ∈ `eligibleTiles`, at least one in-chunk neighbor
   matches `borderingTiles` (if set), and every entry in `requiredOffsets` matches (if
   set). Surviving tiles then take a deterministic seeded roll against `density`.
2. **Stamp + persist** — every chunk is regenerated and `stampPoiLayouts()` writes the
   `layout` of each POI overlapping it (offset/skip-if-outside logic, so layouts straddling
   chunk borders stamp correctly). Chunks are batch-upserted.
3. **Persist POIs** — POI rows are batch-inserted via `batchCreatePois()`
   (`onConflictDoNothing` on `(gridX,gridY)` — re-baking never clobbers live runtime state).

Detection is fully deterministic (seeded per tile + poiType), so the same seed always
produces the same POIs.

---

## 6. Runtime integration

**Inhale.** `loadNeighborhood()` in
[server/engine/tickProcessor.ts](../server/engine/tickProcessor.ts) loads POIs (via
`getPoisInChunkArea`, one chunk beyond the actor box) into `SimulatedState.pois`.

**Movement wake.** `wakePoisNear()` in
[server/actions/_moveHelper.ts](../server/actions/_moveHelper.ts) runs in the `execute()`
of STEP / HOP / SWIM: after the frog moves, every overworld POI in its new 3×3 chunk
neighborhood that is not already active gets a `POI_UPDATE { status: 0 }` instruction,
committed in that subtick's exhale. This is the only thing that wakes a dormant POI.

**The POI heartbeat pass.** `runPoiHeartbeatPass()` in
[server/poi/processor.ts](../server/poi/processor.ts) is a self-contained inhale → process
→ exhale unit:
- *Inhale* — `getActivePois()` (`status IN (-1,0,2)`), `decrementDormantPois()` (the
  `status ≥ 3` countdown), and load frogs across the 3×3 neighborhoods of all `-1`/`0` POIs.
- *Process* — per POI: run startup / hold / start cleanup countdown / run cleanup (see §3).
- *Exhale* — one transaction: insert predators **with `.returning()`**, write the returned
  ids onto the POI's `spawnedPredatorIds`, also insert any `startupItems` (independent
  probability rolls per spec; not tracked on the POI), update `status`/`triggered`, delete
  predators on cleanup.

**Sequencing.** The pass is invoked from `runEngineBroadcast()` in
[server/websockets/socket.ts](../server/websockets/socket.ts) at the 10s heartbeat
boundary, in strict order: **POI pass → `ENGINE_TICK` broadcast → `processEntityIntents()`**.
Running before `ENGINE_TICK` means players see spawned predators in the same vision
refresh as the frog's move; running before entity AI means predators spawned this
heartbeat are committed and get AI intent for the next cycle (they act one heartbeat
after spawning).

---

## 7. The `POI_UPDATE` instruction

`POI_UPDATE` is a new `UpdateInstruction` type ([server/engine/types.ts](../server/engine/types.ts)).
Movement handlers emit it; the generic exhale compiler in `tickProcessor.ts` applies it via
a `poiUpdates` map. The POI heartbeat pass does **not** use it — it owns its own
transaction because it needs the inserted predators' ids.

---

## 8. Client

No client changes. POI layouts are baked into `terrainDataJson` and render as ordinary
terrain; spawned predators render as ordinary predators. The Admin World Inspector's POI
list (`admin.getPoiRegistry`) now reads real `points_of_interest` rows.

---

## 9. Known constraints

- `cleanupDelay` must be ≥ 3 so the countdown passes through `2` (where cleanup fires).
- The POI pass is not guarded by `tickInFlight`; it should finish well under 500ms. Keep
  `density` low so the woken set stays small.
- A predator killed by a frog before cleanup leaves a stale id in `spawnedPredatorIds`; the
  cleanup `DELETE` simply matches nothing for it — harmless.
