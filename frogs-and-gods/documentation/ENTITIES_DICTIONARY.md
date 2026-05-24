# Frogs & Gods — Entities Dictionary

Developer reference for the predator AI system and entity brains. For predator action *handlers* (SLITHER, STRIKE, WRAP), see `ACTIONS_DICTIONARY.md`. For how predator actions flow through the tick processor, see `ACTION_PATH.md`.

---

## 1. Overview

The Entity Library lives in `server/entities/`. It is a **decoupled AI registry** that runs on a separate heartbeat event from frog and god actions.

**Why it exists:**
- Frogs and Gods are player-controlled — their actions arrive via WebSocket or tRPC and are queued manually.
- Predators are AI-controlled — their actions are calculated by the server at the start of each heartbeat cycle and queued as `pending_actions` with future `resolveBucket` values.
- Keeping entity logic in `server/entities/` prevents coupling predator AI to the frog or god action systems. New entity types can be added without touching existing code.

**Key invariant:** Every entity action goes through `pending_actions`. No direct DB writes happen from an AI brain file — all state changes flow through the same action validation and execution pipeline as frog actions.

---

## 2. Architecture

Intent calculation and action resolution are **two separate events**. The brain queues intents at the start of a cycle; the tick processor resolves them across sub-ticks as their bucket arrives.

```
heartbeat.ts
  └── emit("cycle_start")              ← Tick 0 of each new 10s cycle

server/websockets/socket.ts (listener)
  └── processEntityIntents(notify)     ← QUEUES intents only; does NOT resolve them

server/entities/index.ts               ← ENTITY REGISTRY
  ├── getActivePredators()
  └── route by enemyType:
       └── "SNAKE" → calculateSnakeIntent(predator)   ← queues SLITHER or STRIKE pending_action

server/engine/tickProcessor.ts (every 500ms subtick)
  └── processAllActions()
       ├── Pass 1: God actions
       ├── Pass 2: Predator actions  ← resolves SLITHER / STRIKE / WRAP as their bucket arrives
       └── Pass 3: Frog actions
```

`processEntityIntents()` is fire-and-forget (non-blocking). If the DB is slow or no predators exist, the cycle proceeds normally.

---

## 3. Heartbeat Wiring

**cycle_start event — `server/engine/heartbeat.ts`**

```typescript
private _runMainTick(): void {
  this.phase = "broadcast";
  this.emit("broadcast");        // ENGINE_TICK to clients, purge old actions
  this._clearTimers();
  this.phase = "lock_in";
  this._startTimers();           // new subtick interval + 10s timeout begin
  this.emit("cycle_start");      // Tick 0: entity AI queues intents for this cycle
}
```

**Listener — `server/websockets/socket.ts`**

```typescript
heartbeat.on("cycle_start", () => {
  void processEntityIntents(emitToUser);
});
```

---

## 4. Initiative Formula

All entity actions are delayed by an initiative formula calculated at `cycle_start`:

```
resolveBucket = currentBucket + ((10 - speed) * 2) + d4_roll
```

Where:
- `speed` = `predator.statsJson.speed` (integer 1–10; default 5 if unset)
- `d4_roll` = `Math.ceil(Math.random() * 4)` — random jitter 1–4
- `currentBucket` = `Math.floor(Date.now() / 500)` at intent-calculation time

### Speed Reference Table

| Speed | Delay sub-ticks | Wall-time delay | Notes |
|-------|-----------------|-----------------|-------|
| 10    | 1–4             | 0.5–2 s         | Lightning-fast predator |
| 8     | 5–8             | 2.5–4 s         | Quick |
| 5     | 11–14           | 5.5–7 s         | Average (default) |
| 3     | 15–18           | 7.5–9 s         | Sluggish |
| 1     | 19–22           | 9.5–11 s        | May spill into next heartbeat |

**Spillover:** A speed-1 predator with d4=4 gets bucket offset +22. Since a heartbeat is 20 sub-ticks (10s / 500ms), this action resolves during the *next* heartbeat cycle. The predator appears to skip a turn from the player's perspective. This is intentional — extremely slow entities have an inherent chance of failing to act within a cycle.

**d4 jitter:** Prevents entities with the same speed from always resolving on the same frame. Two speed-5 snakes in the same chunk will resolve at slightly different times.

---

## 5. Snake Entity

**File:** `server/entities/snake.ts`  
**Export:** `calculateSnakeIntent(predator: Predator): Promise<void>`  
**enemyType:** `"SNAKE"` | **aiType:** `"HUNTER"`

### State Machine

```
calculateSnakeIntent()
│
├── STARVATION: currentHeartbeat - lastMealTick > 378 AND !wrapping?
│     YES → deletePredator(id), return
│
├── statsJson.wrapping != null?
│     Target frog still alive? → YES: queue STRIKE at frog, return
│                               NO:  updatePredator(wrapping: null), fall through
│     (On successful WRAP: snake teleports body to 3 adjacent '#' tiles around frog)
│
├── Resolve frog list (instance-aware; 3×3 chunk area for overworld)
│
├── isHungry = currentHeartbeat - lastMealTick > 18
│   isHungry AND closest frog Chebyshev ≤ 5?
│     YES → queue STRIKE at closest frog, return
│
└── MOVEMENT (always executes):
      base direction: toward closest frog (if hungry + frogs exist) OR stats.facing
      50% chance to coil-turn (perpendicular closest to body segment)
      validate 2-tile path (intermediate + destination both '#')
      if blocked: try all 8 directions (prefer toward frog when hungry)
      if ALL blocked: persist random facing, idle
      queue SLITHER to head + 2·(dx,dy)
```

### Hunger Mechanics

- **Storage column:** `predators.lastMealTick` — stores the **heartbeat number** at which the snake last ate. Heartbeat number = `Math.floor(Date.now() / 10_000)`.
- **Hungry threshold:** `currentHeartbeat - lastMealTick > 18` (18 heartbeats × 10s = 3 minutes).
- **Hunger effects:** Controls whether the snake STRIKEs and whether it biases movement toward prey. A non-hungry snake still moves every heartbeat (coil wander).
- **Hunger reset:** Only when a frog dies from a STRIKE. Reset happens inside `strike.ts:execute`.
- **Spawn value:** Both spawn handlers (`spawn.ts`, `divine_spawn_predator.ts`) write `lastMealTick = Math.floor(Date.now() / 10_000)` — new snakes start with a fresh clock.

| Threshold | Heartbeats since last meal | Wall time | Effect |
|-----------|---------------------------|-----------|--------|
| Hungry    | > 18 | ~3 min | Pursues frogs; STRIKEs if within range 5 |
| Starved   | > 378 | ~63 min | Despawned (silent) |

### Starvation Despawn

Snakes that have been starved for over 1 hour are silently deleted at the start of their next `cycle_start`.

- **Threshold:** `currentHeartbeat - predator.lastMealTick > 378` (18 hungry + 360 starved = ~63 min)
- **Checked at:** top of `calculateSnakeIntent`, before the wrapping check
- **Wrap exemption:** A snake actively constricting a frog (`stats.wrapping != null`) is skipped. It finishes the constriction; on the next `cycle_start` after the target frog is gone and `wrapping` is cleared, the starvation check fires
- **No world log** — the predator row is hard-deleted via `deletePredator(id)` with no broadcast (any carried loot is dropped first — see Loot Carry & Drop)
- **Chunk XP grant** — immediately before `deletePredator()`, `awardChunkXpDirect(predator)` is called. Every living frog in the snake's chunk (matched on `instanceId`) receives the full `XP_REWARD_BY_ENEMY_TYPE.SNAKE` reward via a direct DB write. This bypasses the Exhale pipeline because starvation runs in the entity-intent phase, not as a pending action.
- **Pre-existing snakes:** Snakes that existed in the DB before this feature shipped have `lastMealTick = 0` and will despawn on their first `cycle_start`

### Loot Carry & Drop

Snakes can spawn carrying an item and drop it on death.

- **Storage column:** `predators.lootItems` — a `jsonb` array of item UUIDs (default `[]`).
- **Acquired on spawn:** Only natural croak-spawned snakes roll for loot (10% chance — see CROAK in `ACTIONS_DICTIONARY.md`). God-spawned snakes (`spawn.ts`, `divine_spawn_predator.ts`) never carry loot.
- **Carried state:** A claimed item sits at `itemState = 'PREDATOR'` with null grid coords while held. The link is one-way: `predators.lootItems` → item.
- **Dropped on death:** Every death path drops carried items to `itemState = 'GROUND'` at the snake's head tile, inheriting the snake's `instanceId`:
  - Combat kill & divine smite — batched via `dropPredatorLoot()` (`_utils.ts`), pushing `ITEM_UPDATE`s into the Exhale.
  - Starvation despawn — direct `updateItem()` writes, since that path runs outside the batched Exhale.

### Frog Detection

Snakes search a **3×3 chunk area** (48×48 tiles) centered on their chunk:
```typescript
minGX = (chunkX - 1) * 16;  maxGX = (chunkX + 2) * 16 - 1;
minGY = (chunkY - 1) * 16;  maxGY = (chunkY + 2) * 16 - 1;
getFrogsInBounds(minGX, maxGX, minGY, maxGY)
```
**Lair predators** (instanceId != null) use `getFrogsByInstanceId(instanceId)` instead — they cannot see overworld frogs.

Dead frogs are filtered (`!frog.isDead`). The closest survivor by Chebyshev distance is targeted.

### Movement Model

Snakes move **2 tiles per SLITHER** in an 8-directional unit direction (cardinal + diagonal):

- **Terrain restriction:** Both the intermediate tile (head + 1 step) and the destination must be `#` (land). Peaks, water, lily pads, and doors block the move.
- **Persistent facing:** `statsJson.facing = {dx, dy}` stores the current unit direction and is updated by each successful SLITHER.
- **Coil turns:** 50% chance per heartbeat. Pick the 90° perpendicular direction (`left: (-dy, dx)`, `right: (dy, -dx)`) whose 2-tile destination is closest (by Chebyshev) to a body segment. If neither perpendicular path is walkable, skip the turn.
- **Blocked fallback:** If the chosen direction's 2-tile path is blocked, try all 8 unit directions (preferring toward the frog when hungry). If all are blocked, persist a random facing and idle this heartbeat.
- **Always moves:** Even when not hungry, the snake slithers in a wandering coil pattern every heartbeat.

### Segment Layout

```
Snake body: [HEAD (gridX/gridY)] → [segments[0] = middle] → [segments[1] = tail]
```

After a 2-tile SLITHER in direction `(dx, dy)`:
- New head = `head + (2·dx, 2·dy)`
- New `segments[0]` = `head + (dx, dy)` (intermediate tile)
- New `segments[1]` = old head position → **tail always ends where head was**

On spawn, initialize coiled (all segments at same position):
```typescript
statsJson: {
  speed: 5,
  segments: [
    { x: spawnX, y: spawnY },
    { x: spawnX, y: spawnY },
  ],
  wrapping: null,
  facing: null,   // set on first SLITHER
}
```

---

## 6. Golem Entity

**File:** `server/entities/golem.ts`  
**Export:** `calculateGolemIntent(predator: Predator): Promise<void>`  
**enemyType:** `"GOLEM"` | **aiType:** `"HUNTER"` (default)

### Overview

Golems are stationary 3×3 tile creatures placed by divine intervention. They never move on their own — they only reposition after landing a kill. Each heartbeat they check for frogs within crush range and queue a CRUSH action if any are found.

### State Machine

```
calculateGolemIntent()
│
├── STARVATION: currentHeartbeat - lastMealTick > 540 (~90 min)?
│     YES → drop loot, deletePredator(id), return
│
├── Scan frogs in 3×3 chunk neighborhood (same as snake)
├── Filter: distanceToGolem(cx, cy, fx, fy) <= 2
│
├── Any in range?
│     NO  → idle, return
│     YES → sort by distanceToGolem ASC, tie-break by frog ID
│            queue CRUSH at closest frog's tile, return
```

### Position Model

The golem's `gridX/gridY` represents the **center tile** of the 3×3 body. The other 8 tiles are always `center ± 1` in x and y — they are never stored separately.

```
(cx-1, cy-1) (cx, cy-1) (cx+1, cy-1)
(cx-1, cy  ) (cx, cy  ) (cx+1, cy  )   ← center = gridX/gridY
(cx-1, cy+1) (cx, cy  ) (cx+1, cy+1)
```

### Crush Range (CRUSH action)

Range is measured from the **nearest golem tile** to the target:
```typescript
// Exact formula (no rounding)
nearestX = clamp(targetX, cx-1, cx+1)
nearestY = clamp(targetY, cy-1, cy+1)
distance = chebyshevDistance(nearestX, nearestY, targetX, targetY)
// Within range when distance <= 2
```
This effectively means frogs within Chebyshev ≤ 3 of center are in range.

### Post-Kill Repositioning

When CRUSH kills the primary target frog, the golem slides so its nearest tile occupies the dead frog's previous position:
```typescript
nearestX = clamp(fx, cx-1, cx+1)
nearestY = clamp(fy, cy-1, cy+1)
newCenter = { x: cx + (fx - nearestX), y: cy + (fy - nearestY) }
```

### Crush Zone (3-path sweep)

CRUSH damages all frogs along lines from the **3 nearest golem tiles** to the target:
1. Rank all 9 golem tiles by `chebyshevDistance(tile, target)`, take 3 closest.
2. For each of the 3, compute `getLineTiles(tile, target)` (excludes tile, includes target).
3. Deduplicate all tiles by coordinate.
4. Apply 15 damage to every unique frog on any zone tile.
5. Primary target's death is what triggers repositioning.

### Golem statsJson

```typescript
// Golems store only speed in statsJson. No segments, no facing, no wrapping.
{ speed: 3 }
```

### Frog Movement Blocking

All 9 golem tiles physically block frog movement:
- **STEP:** returns silent reject `"A golem blocks the way."` (turn NOT consumed)
- **HOP:** returns FUMBLE `"<name> crashes into a golem!"` (turn consumed)
- **SWIM:** returns silent reject `"A golem blocks the shore."` if destination is golem tile

### Loot

Golems can carry `GOLEM_LOOT` items (loot pool currently empty — items to be created separately). On death or starvation despawn, all carried items drop to the ground at the golem's center tile. Spawn loot: same 10% chance as snakes, using the GOLEM_LOOT pool.

### Chunk XP Grant on Death

Both pipeline kills (via `applyDamage` → `awardChunkXp`) and starvation despawn (via `awardChunkXpDirect` called right before `deletePredator`) grant `XP_REWARD_BY_ENEMY_TYPE.GOLEM` (75 XP) to every living frog in the golem's chunk, matched on `instanceId`.

---

## 7. DB Schema

### `predators` Table Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | Predator DB identity; used as `actorId` in pending_actions |
| `enemy_type` | enum | `"SNAKE"`, `"GOLEM"`, or `"FLY"` (FLY is a stub — see `THE_VOID_INVENTORY.md`) |
| `ai_type` | enum | `"HUNTER"`, `"REACTIVE"`, `"DOCILE"` (only HUNTER has behavior — see `THE_VOID_INVENTORY.md`) |
| `grid_x` | integer | Head position — authoritative tile X |
| `grid_y` | integer | Head position — authoritative tile Y |
| `chunk_x` | integer | `Math.floor(grid_x / 16)` — denormalized for chunk queries |
| `chunk_y` | integer | `Math.floor(grid_y / 16)` |
| `current_hp` | integer | Hit points; set to 0 when killed |
| `last_meal_tick` | integer | Heartbeat number of last kill. `0` = never fed (always hungry) |
| `stats_json` | jsonb | See PredatorStats below |

### `PredatorStats` Interface (`statsJson` shape for SNAKE)

```typescript
interface PredatorStats {
  speed?:     number;                           // 1–10; initiative formula input. Default: 5
  segments?:  Array<{ x: number; y: number }>; // Body tiles. [0] = middle, [1] = tail
  wrapping?:  { targetFrogId: number } | null; // Active constriction. null = not wrapping
  facing?:    { dx: number; dy: number };       // Persisted 8-dir unit vector; set on first SLITHER

  // Ghost field — defined but never written or read:
  mutations?: string[];      // Future mutation flags (never used)

  [key: string]: unknown;    // Open for future entity-type-specific fields
}
```

### `frog.statsJson.wrappedBy` Companion Field

When a frog is constricted, a matching field is set on the frog side:
```typescript
// FrogStats addition:
wrappedBy?: number | null;  // predator.id of the snake holding this frog
```

Both `predator.statsJson.wrapping` and `frog.statsJson.wrappedBy` **must be cleared together**. This is handled atomically by `rollConditionCheck()` in `_conditionUtils.ts` on escape, or by death cleanup in the relevant action handler.

---

## 7. Condition System

**File:** `server/actions/_conditionUtils.ts`

Conditions are evaluated **on-demand** — there is no passive sweep. When a frog tries to act, the tick processor calls `rollConditionCheck()` inside the action's `validate()` phase. This avoids any background process and ensures conditions are checked exactly when they matter.

### WRAP Condition

| | |
|--|--|
| **Set by** | `strike.ts` execute (optimistically) + `wrap.ts` execute (canonically) |
| **Cleared by** | `rollConditionCheck()` on successful escape, or death of either entity |
| **Escape roll** | `Math.max(frog.statsJson.str, frog.statsJson.dex) >= 15` |
| **Turn cost** | Failed escape = FUMBLE (turn consumed, frog still wrapped) |

A frog with both STR < 15 and DEX < 15 cannot escape without stat growth or divine intervention. A frog with either stat ≥ 15 always escapes on their next action attempt.

### How to Add a New Condition

1. Add a flag to `FrogStats` in `drizzle/schema.ts` (e.g. `stunned?: boolean`).
2. Add a branch in `rollConditionCheck()` in `_conditionUtils.ts` that checks and clears the flag.
3. Have the entity action that imposes the condition set the flag during `execute()`.
4. Frog actions that should be blocked or modified by the condition will automatically pick it up via the `rollConditionCheck()` call in their `validate()`.

---

## 8. Admin Spawn / Kill Flow

Predators can be created and destroyed via the Enemy Management tab in the Admin panel.

**Spawn:**
1. Admin fills in X/Y, type, AI, speed, HP → clicks "Spawn Enemy"
2. `admin.triggerSpawn` queues a `SPAWN_PREDATOR` action (`actorId = 0`, current bucket)
3. On the next sub-tick, Pass 1 runs: `spawnPredatorHandler.validate()` checks tile exists and is not `≈` → `execute()` inserts the predator row
4. Enemies tab auto-refreshes every ENGINE_TICK

**Kill:**
1. Admin clicks "Smite" on any row
2. `admin.triggerKill` queues `KILL_PREDATOR` (`actorId = 0`)
3. On the next sub-tick, `killPredatorHandler.execute()` hard-deletes the predator row
4. Predator's `'S'` glyph disappears from canvas on next vision refetch

---

## 8b. POI Spawn / Cleanup Flow

Predators are also spawned and removed by the **Point of Interest system** — procedural
ambush encounters baked into the world. This path is independent of the action queue.

**Spawn:** when a frog moves near a baked POI, the POI heartbeat pass
(`runPoiHeartbeatPass()` in `server/poi/processor.ts`) runs the POI type's `startup`
function and inserts the predator rows in its own transaction, recording their ids on the
POI's `spawnedPredatorIds` column. Predators spawned this way get their first AI intent on
the following `cycle_start` (they act one heartbeat after spawning).

**Cleanup:** after the frog leaves and the POI's grace countdown elapses, the same pass
hard-deletes exactly those `spawnedPredatorIds` and resets the POI.

Full detail: `documentation/POI_SYSTEM.md` and `documentation/POI_DICTIONARY.md`.

---

## 9. Planned Entity Types

### FLY

- **Defined in:** `drizzle/schema.ts` (enemyTypeEnum includes `"FLY"`), `shared/game.schema.ts` (EnemyTypeSchema)
- **Missing:** `server/entities/fly.ts` brain file, PREDATOR_ACTION_REGISTRY entries (no FLY actions), routing branch in `entities/index.ts`
- **Current behavior if spawned:** A FLY predator can be spawned via admin. `processEntityIntents()` will silently skip it (no routing branch). It will sit idle indefinitely — no movement, no attacks.

See `THE_VOID_INVENTORY.md` for full ghost status.

---

## 10. How to Add a New Entity Type

1. **Create** `server/entities/<type>.ts` with:
   ```typescript
   export async function calculate<Type>Intent(predator: Predator): Promise<void>
   ```
2. **Add action types** as constants in `server/actions/_predator_action_types.ts`.
3. **Create action handler files** in `server/actions/` implementing `PredatorActionHandler`.
4. **Register actions** in `PREDATOR_ACTION_REGISTRY` in `server/actions/index.ts`.
5. **Add a routing branch** in `server/entities/index.ts`:
   ```typescript
   if (predator.enemyType === "FLY") {
     await calculateFlyIntent(predator);
   }
   ```
6. **Document** in this file (`ENTITIES_DICTIONARY.md`) and in `ACTIONS_DICTIONARY.md`.

---

## Key Files

| Purpose | File |
|---------|------|
| Entity registry (cycle_start) | `server/entities/index.ts` |
| Snake AI brain | `server/entities/snake.ts` |
| Golem AI brain | `server/entities/golem.ts` |
| Heartbeat (cycle_start event) | `server/engine/heartbeat.ts` |
| Heartbeat listener wiring | `server/websockets/socket.ts` |
| Tick processor (3 passes) | `server/engine/tickProcessor.ts` |
| SimulatedState type | `server/engine/types.ts` |
| SLITHER action | `server/actions/slither.ts` |
| STRIKE action | `server/actions/strike.ts` |
| WRAP action | `server/actions/wrap.ts` |
| CRUSH action | `server/actions/crush.ts` |
| Predator action constants | `server/actions/_predator_action_types.ts` |
| Predator handler interface | `server/actions/_predator_types.ts` |
| Condition utility | `server/actions/_conditionUtils.ts` |
| DB queries for predators | `server/db.ts` → `getPredatorById`, `getActivePredators`, `updatePredator`, `getWrappingPredators`, `getPendingPredatorActions` |
| DB schema + PredatorStats type | `drizzle/schema.ts` |
