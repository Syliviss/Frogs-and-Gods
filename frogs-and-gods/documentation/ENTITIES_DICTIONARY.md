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
├── statsJson.wrapping != null?
│     YES → HOLD: snake is already constricting — return (no new action queued)
│     NO  ↓
│
├── currentHeartbeat - lastMealTick > 18?
│     NO  → IDLE: satiated — return (snake does not hunt while fed)
│     YES ↓
│
├── frogs in chunk?
│     NO  → IDLE: no prey visible — return
│     YES ↓
│
└── closest frog Chebyshev distance <= 1?
      YES → queue STRIKE
      NO  → queue SLITHER toward closest frog
```

### Hunger Mechanics

- **Storage column:** `predators.lastMealTick` — stores the **heartbeat number** at which the snake last ate. Heartbeat number = `Math.floor(Date.now() / 10_000)`.
- **Hungry threshold:** `currentHeartbeat - lastMealTick > 18` (18 heartbeats × 10s = 3 minutes).
- **Hunger reset:** Only when a frog **dies** from a STRIKE (newHp ≤ 0). A snake that wraps but whose target escapes does NOT reset hunger. Reset happens inside `strike.ts` execute.
- **Default value:** `lastMealTick = 0` on spawn. In 2026 the current heartbeat number is ~174M, so `174M - 0 >> 18` — newly spawned snakes are immediately hungry. This is intentional.

### Frog Detection

The snake searches for frogs within its own 16×16 chunk:
```typescript
minGX = chunkX * 16;  maxGX = minGX + 15;
minGY = chunkY * 16;  maxGY = minGY + 15;
getFrogsInBounds(minGX, maxGX, minGY, maxGY)
```
Dead frogs are filtered (`!frog.isDead`). The closest survivor by Chebyshev distance is targeted. Equidistant frogs: first row returned by DB query wins (no tiebreak).

### Slither Pathfinding

One greedy Chebyshev step toward the closest frog per cycle:
```typescript
targetGridX = predator.gridX + Math.sign(closestFrog.gridX - predator.gridX)
targetGridY = predator.gridY + Math.sign(closestFrog.gridY - predator.gridY)
```
Diagonal movement is allowed. No pathfinding around obstacles — the snake will path directly through terrain regardless of tile cost. Future improvement: A* or flow-field if obstacle avoidance is needed.

### Segment Layout

```
Snake body: [HEAD (gridX/gridY)] → [segments[0]] → [segments[1] = tail]
```

On spawn, initialize coiled (all segments at same position):
```typescript
statsJson: {
  speed: 5,
  segments: [
    { x: spawnX, y: spawnY },   // body1 = coiled at head
    { x: spawnX, y: spawnY },   // body2 = coiled at head
  ],
  wrapping: null,
}
```
The body spreads naturally as the snake slithers. On each SLITHER: current `gridX/gridY` → segments[0], old segments[0] → segments[1] (tail drops off).

---

## 6. DB Schema

### `predators` Table Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | Predator DB identity; used as `actorId` in pending_actions |
| `enemy_type` | enum | `"SNAKE"` or `"FLY"` (FLY is a stub — see `THE_VOID_INVENTORY.md`) |
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
  segments?:  Array<{ x: number; y: number }>; // Body tiles. [0] = body1, [1] = tail
  wrapping?:  { targetFrogId: number } | null; // Active constriction. null = not wrapping

  // Ghost fields — defined but never written or read:
  path?:      number[][];    // Reserved for future pathfinding (never used)
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

## 9. Planned Entity Types

### FLY

- **Defined in:** `drizzle/schema.ts` (enemyTypeEnum: `["SNAKE", "FLY"]`), `shared/game.schema.ts` (EnemyTypeSchema)
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
| Heartbeat (cycle_start event) | `server/engine/heartbeat.ts` |
| Heartbeat listener wiring | `server/websockets/socket.ts` |
| Tick processor (3 passes) | `server/engine/tickProcessor.ts` |
| SimulatedState type | `server/engine/types.ts` |
| SLITHER action | `server/actions/slither.ts` |
| STRIKE action | `server/actions/strike.ts` |
| WRAP action | `server/actions/wrap.ts` |
| Predator action constants | `server/actions/_predator_action_types.ts` |
| Predator handler interface | `server/actions/_predator_types.ts` |
| Condition utility | `server/actions/_conditionUtils.ts` |
| DB queries for predators | `server/db.ts` → `getPredatorById`, `getActivePredators`, `updatePredator`, `getWrappingPredators`, `getPendingPredatorActions` |
| DB schema + PredatorStats type | `drizzle/schema.ts` |
