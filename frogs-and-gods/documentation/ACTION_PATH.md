# Frogs & Gods — Action Path

Full lifecycle of a game action: from UI click to `pending_actions` insert to heartbeat resolution to client notification.

---

## Overview

All state-altering commands — regardless of source — must insert a row into `pending_actions`. The heartbeat engine picks them up every 500ms and resolves them through a unified pipeline.

| Path | When used | Transport |
|------|-----------|-----------|
| **tRPC HTTP** | Admin dev console | `POST /api/trpc` |
| **WebSocket `SUBMIT_ACTION`** | Live gameplay | WebSocket message |

Both paths converge at `createPendingAction()` in `server/db.ts`. After insertion, the tick processor resolves actions through the same inhale/exhale pipeline regardless of origin.

---

## Part 1: Entry Points

### Path A — tRPC HTTP (Admin/Dev)

**File:** `server/routers/admin.ts`

#### `admin.submitActionForFrog` — frog item actions
Used by `InventoryTab.tsx` for EQUIP, UNEQUIP, GIVE.
```
InventoryTab.tsx
  └─ trpc.admin.submitActionForFrog.mutate({ frogId, actionType, payload })
       └─ createPendingAction({ actorId: frogId, actionType, resolveBucket, payload })
       └─ returns { queued: true, pendingActionId }
```

#### `admin.submitMovementForFrog` — STEP / HOP
Used by the vision panel in `Admin.tsx` + `ActionBar.tsx`.
```
ActionBar.tsx
  └─ trpc.admin.submitMovementForFrog.mutate({ frogId, actionType, targetGridX, targetGridY })
       └─ validateAndQueueMovement() ← server/engine/movement.ts (pre-validates range + terrain)
       └─ createPendingAction({ actorId: frogId, actionType, targetGridX, targetGridY, resolveBucket })
```

#### God actions (actorId = 0)
`admin.createItem` → queues `CREATE_ITEM`  
`admin.spawnItem` → queues `SPAWN_ITEM`  
`admin.triggerSpawn` → queues `SPAWN_PREDATOR`  
`admin.triggerKill` → queues `KILL_PREDATOR`  

All set `actorId = 0` (system sentinel) and `resolveBucket = Math.floor(Date.now() / 500)`.

### Path B — WebSocket `SUBMIT_ACTION` (Live Gameplay)

**File:** `server/websockets/socket.ts`

```
Client WS message: { type: "SUBMIT_ACTION", actionType, payload, targetGridX?, targetGridY? }
  └─ socket.ts case "SUBMIT_ACTION":
       └─ getFrogByOwnerId(userId) — verify sender owns the frog
       └─ pendingIntents.push({ actorId: frog.id, actionType, resolveBucket, payload, ... })
       └─ ws.send({ type: "ACTION_QUEUED" })   ← immediate ack, no pendingActionId
```

**Intake buffer:** `SUBMIT_ACTION` does not write to the DB immediately. Instead, all incoming intents are pushed to a `pendingIntents[]` array. A `setInterval(100ms)` loop runs in the background and flushes the batch with a single `db.insert(pendingActions).values(batch)`. Actions then wait for the next 500ms sub-tick to be picked up by `processAllActions()`.

This means the client receives `ACTION_QUEUED` before the action is persisted to the DB. The action resolves at the next sub-tick (up to 600ms later).

```typescript
// Inside socket.ts — the 100ms intake flush
setInterval(() => {
  if (pendingIntents.length === 0) return;
  const batch = [...pendingIntents];
  pendingIntents = [];
  db.insert(pendingActions).values(batch);
}, 100);
```

---

## Part 2: `pending_actions` Table

**File:** `drizzle/schema.ts`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | Row identity |
| `actorId` | integer | Frog ID performing the action. `0` = god/system action |
| `actionType` | varchar(64) | `"EQUIP"`, `"STEP"`, `"SPAWN_PREDATOR"`, etc. |
| `targetGridX` | integer? | Target tile X (spatial actions only) |
| `targetGridY` | integer? | Target tile Y |
| `resolveBucket` | bigint | `Math.floor(Date.now() / 500)` — which 500ms window this action resolves in |
| `payload` | jsonb | Action-specific data: `{ itemId?, targetFrogId?, targetTiles?, ... }` |
| `status` | enum | `"pending"` → `"resolved"` or `"cancelled"` |
| `resolvedAt` | timestamp? | Set when processed |
| `createdAt` | timestamp | Insertion time |

**resolveBucket math:** Unix timestamp in ms ÷ 500, rounded down. All actions inserted in the same 500ms window share a bucket. The tick processor processes all actions where `resolveBucket <= currentBucket`.

---

## Part 3: The Heartbeat Loop

**File:** `server/engine/heartbeat.ts`

`HeartbeatEngine` extends `EventEmitter`. Single instance created in `server/_core/index.ts`.

```
HeartbeatEngine
│
├── setInterval (500ms) ──► emit("subtick")
│                              └─► processAllActions()     ← tick processor runs
│                              └─► flushActionLogs()       ← broadcast SUBTICK_LOGS
│                              └─► broadcast ENGINE_QUIVER ← 500ms pulse to clients
│
└── setTimeout (10_000ms) ─► emit("broadcast")
                               └─► broadcast ENGINE_TICK   ← 10s cycle marker
                               └─► purgeResolvedActions()  ← clean up old rows
                               └─► restarts setTimeout
                               └─► emit("cycle_start")     ← Tick 0: entity AI queues intents
```

**ENGINE_QUIVER** — fires every 500ms. Clients use this for sub-tick polling.  
**ENGINE_TICK** — fires every 10s. Clients use this to refetch world state and unlock UI.  
**cycle_start** — fires at the top of each new 10s cycle. `socket.ts` listens and calls `processEntityIntents()` so predator AI queues its intents for the coming cycle.

The listener wiring lives in `server/websockets/socket.ts`:
```typescript
heartbeat.on("subtick",      () => { void processAllActions(emitToUser); });
heartbeat.on("broadcast",    () => { broadcast({ type: "ENGINE_TICK", ... }); });
heartbeat.on("cycle_start",  () => { void processEntityIntents(emitToUser); });
```

---

## Part 4: The Tick Processor (`processAllActions`)

**File:** `server/engine/tickProcessor.ts`

### The Great Inhale

Before any action handler runs, the processor loads a snapshot of the world into memory:

```
1. Fetch pending god actions, predator actions, and frog actions for currentBucket
2. Calculate a bounding box from actor positions + target coords (padded +5 tiles for AoE)
3. Bulk-fetch into SimulatedState:
   - frogs in bounds             → state.frogs
   - items in bounds + owned     → state.items
   - predators in chunk area     → state.predators
   - chunks in bounding box      → state.chunks
```

`SimulatedState` is defined in `server/engine/types.ts`. It is an in-memory replica of the relevant DB slice for this tick.

**CRITICAL RULE:** Action handlers must never import from `../db`. All reads come from `state`, all writes go to `state` + `out` (the `UpdateInstruction[]` array).

### Sort Order

Before the loop runs, all pending actions are sorted:
1. **God actions first** (`GOD_ACTION_REGISTRY` check — bubbles to top)
2. **Then by DEX/speed descending** — frogs sort by `statsJson.dex`, predators by `statsJson.speed`

This ensures items created by gods exist before frogs act in the same tick.

### The Living Ledger — One Sorted Loop

All actions (god, predator, frog) are resolved in a single unified `for` loop. The registry check inside the loop determines which handler interface is used:

**God actions** (`GOD_ACTION_REGISTRY`):
- `actorId = 0`, `GodActionContext`, no fumble, no turn consumption
- Uses `GodActionResult` with `.success` field (not `.ok`)
- On validation failure: `ACTION_CANCEL`
- On unknown type: `ACTION_CANCEL`

**Predator actions** (`PREDATOR_ACTION_REGISTRY`):
- Predator must exist and have `currentHp > 0` in SimulatedState
- Uses `PredatorActionResult` with `.success` field
- Handler signature: `validate(ctx, predator, state)` / `execute(ctx, predator, state, out)` / `broadcast(ctx, predator, result, notify)`
- On validation failure: `ACTION_CANCEL`

**Frog actions** (`ACTION_REGISTRY`):
Three sequential gates before any handler runs:

| Gate | Check | On failure |
|------|-------|------------|
| 1. Dedup | Frog actor ID already in `handledActorsThisTick` set? | `ACTION_CANCEL` (not resolved — the duplicate row is cancelled) |
| 2. Alive | Frog exists in SimulatedState and `isDead = false`? | `ACTION_CANCEL` |
| 3. Validate | `handler.validate(ctx, state)` returns `ok: true`? | FUMBLE or silent reject — see below |

The actor ID is added to `handledActorsThisTick` immediately before `validate()` runs — so even a FUMBLE blocks further actions for that frog this tick.

**FUMBLE** (`ok: false, code: "FUMBLE"`) — turn consumed. The original action row is pushed to `ACTION_RESOLVE`. No sentinel row is inserted — the `handledActorsThisTick` set already blocks any remaining queued actions. A FUMBLE WS message is sent to the player immediately.

**Silent reject** (`ok: false`, no code) — turn preserved. The row is pushed to `ACTION_CANCEL`. The frog ID is NOT added to `handledActorsThisTick` — they can still act this heartbeat if another action is in the queue.

If `validate()` returns `ok: true`: calls `handler.execute(ctx, state, out)` then `handler.broadcast(ctx, result, notify)`.

### The Great Exhale — Batched & Merged

After all actions in the loop resolve, `updateQueue: UpdateInstruction[]` is flushed in a single `db.transaction()`. The exhale compiles the queue into typed Maps before executing:

```
UpdateInstruction[]
  │
  ├── Compile phase (merge multiple updates to same entity):
  │     frogUpdates:      Map<id, Partial<Frog>>     ← multiple FROG_UPDATEs merged via spread
  │     predatorUpdates:  Map<id, Partial<Predator>>
  │     itemUpdates:      Map<id, Partial<Item>>
  │     itemsToInsert:    Item[]                      ← ITEM_INSERT
  │     predatorsToInsert: Predator[]                 ← PREDATOR_INSERT
  │     predatorsToDelete: Set<id>                    ← PREDATOR_DELETE
  │     actionsToInsert:  PendingAction[]             ← ACTION_INSERT
  │     logsToInsert:     WorldLogEvent[]             ← WORLD_LOG_INSERT
  │     resolvedActions:  Set<id>                     ← ACTION_RESOLVE → bulk UPDATE ... SET status="resolved"
  │     cancelledActions: Set<id>                     ← ACTION_CANCEL  → bulk UPDATE ... SET status="cancelled"
  │
  └── Execute phase (inside db.transaction()):
        - One UPDATE per modified frog/predator/item
        - Bulk INSERT for new items, predators, actions, logs (if any)
        - Bulk DELETE for killed predators (if any)
        - One inArray UPDATE for all resolved action IDs
        - One inArray UPDATE for all cancelled action IDs
```

**Merge semantics:** If two actions in the same tick both modify frog #42 (e.g. STRIKE applies damage, then WRAP sets a condition), the Map accumulates `{ ...first_changes, ...second_changes }` and issues a single `UPDATE frogs SET ...` rather than two round-trips.

All writes happen atomically. If any write fails, the entire tick rolls back — no partial state.

---

## Part 5: Generic Intent Builder (SWING / Schema-Driven Actions)

**Files:** `client/src/hooks/useItemIntentBuilder.ts`, `server/routers/admin.ts` → `submitItemActionForFrog`

Some actions (currently SWING) require the player to select target tiles before submitting. These use a deferred resolveBucket to simulate cast time.

```
Player clicks SWING in ActionBar
  └─► ActionBar.onAction("SWING", itemId, actionSchema)
        └─► intentBuilder.startTargeting(itemId, actionSchema)
               mode = "TARGETING"
               Viewport renders orange hover tiles, red confirmed tiles

Player clicks tiles (up to schema.targeting.count)
  └─► intentBuilder.handleTileClick(gridX, gridY)
        - Client-side Chebyshev guard (dist > max_range → ignore)
        - Append to selectedTiles[]
        - If selectedTiles.length === count → auto-submit

──────────────────────────────────────────────────────────
tRPC: admin.submitItemActionForFrog
──────────────────────────────────────────────────────────
Server validation:
  - frog alive, item EQUIPPED by this frog
  - actionSchema parses (ActionSchemaSchema)
  - targetTiles.length === schema.targeting.count
  - each tile ≤ max_range Chebyshev from frog

Poise gate:
  - hasPendingActionForFrog(frogId)? → TRPCError "Frog is in Poise"

Queue with deferred bucket:
  resolveBucket = floor(Date.now() / 500) + ceil(cast_time_ms / 500)
  payload = { itemId, targetTiles }

Client receives { queued: true, resolvesInMs }
ActionBar shows spinner until ENGINE_TICK releases lock

──────────────────────────────────────────────────────────
cast_time_ms later: processAllActions() → Pass 3
──────────────────────────────────────────────────────────
swingHandler.validate():
  - item still EQUIPPED? (frog may have unequipped during cast)
  - each tile still in range? (frog may have moved)
  - checkItemFumble()

swingHandler.execute():
  - for each target tile: getFrogsAt / getPredatorsAt → applyDamage (str + equippedAttackBonus)
  - same entity across multiple tiles = multiple damage hits

swingHandler.broadcast():
  - pushActionLog per damaged entity (category: "combat")
  - notify(ownerId, { type: "SWING_RESOLVED", targetTiles, damaged })
```

---

## Part 6: Client Notification

### Immediate — targeted WebSocket message
Each handler's `broadcast()` phase calls `notify(userId, data)`:
```
{ type: "ITEM_EQUIPPED", itemId }
{ type: "ACTION_RESOLVED", gridX, gridY }
{ type: "FUMBLE", message }
{ type: "SWING_RESOLVED", targetTiles, damaged }
```
Delivered immediately when the action resolves, before the next ENGINE_TICK.

### Polling — ENGINE_TICK (10s cycle)
`InventoryTab.tsx` and `GamePage.tsx` listen for ENGINE_TICK via WebSocket:
```typescript
// on ENGINE_TICK:
inventory.refetch()
equipped.refetch()
pendingFrogs.clear()   // re-enable action buttons
```
This is why the admin UI shows a "waiting for heartbeat" state after submitting an action — buttons stay locked until the 10s cycle confirms the resolved state.

---

## Key Files

| Role | File |
|------|------|
| Express + WebSocket server | `server/_core/index.ts` |
| tRPC admin mutations | `server/routers/admin.ts` |
| WebSocket message handler | `server/websockets/socket.ts` |
| DB query functions | `server/db.ts` |
| Heartbeat timers | `server/engine/heartbeat.ts` |
| Tick processor (inhale/exhale) | `server/engine/tickProcessor.ts` |
| SimulatedState type | `server/engine/types.ts` |
| Action registries | `server/actions/index.ts` |
| Zod input schemas | `shared/game.schema.ts` |
| tRPC client setup | `client/src/lib/trpc.ts` |
| Admin inventory UI | `client/src/components/admin/InventoryTab.tsx` |
| Action bar + targeting UI | `client/src/components/ActionBar.tsx` |
| SWING targeting hook | `client/src/hooks/useItemIntentBuilder.ts` |
| Canvas renderer | `client/src/components/Viewport.tsx` |
