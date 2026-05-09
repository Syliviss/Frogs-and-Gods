# Admin UI → Server Action Flow

This document traces how the admin UI submits game "actions" — things like equipping an item or moving a frog — all the way through the server and back to the client.

---

## Overview

There are two transport paths for actions:

| Path | When used | Transport |
|------|-----------|-----------|
| **tRPC HTTP mutation** | Admin UI testing | `POST /api/trpc` |
| **WebSocket `SUBMIT_ACTION`** | Live gameplay | WebSocket message |

Both paths ultimately write a row to the `pending_actions` database table. The heartbeat engine picks those rows up every 500ms and resolves them through the action handler pipeline.

> **ARCHITECTURAL RULE:** All state-altering commands — including Admin mutations — MUST insert a row into `pending_actions`. Direct DB writes from tRPC routers are deprecated. The engine resolves all `pending_actions` within 500ms of insertion.

### Transport Path Reference

| Mutation / Action | Transport | Pattern | Notes |
|---|---|---|---|
| `admin.createItem` | tRPC HTTP | queues `CREATE_ITEM` → pending_actions | god action loop (runs first) |
| `admin.spawnItem` | tRPC HTTP | queues `SPAWN_ITEM` → pending_actions | god action loop (runs first) |
| `admin.submitActionForFrog` | tRPC HTTP | queues frog action → pending_actions | frog DEX loop |
| `admin.submitMovementForFrog` | tRPC HTTP | queues frog move → pending_actions | frog DEX loop |
| WebSocket `SUBMIT_ACTION` | WS | queues → pending_actions | frog DEX loop |
| `admin.grantXp`, `admin.resurrectFrog` | tRPC HTTP | **direct DB write — legacy** | to be migrated to pending_actions |

### God Action Loop

`CREATE_ITEM` and `SPAWN_ITEM` are **god actions** — they have no frog actor. They are dispatched by a dedicated `processGodActions()` pass in `server/engine/tickProcessor.ts` that runs **before** the frog DEX-sorted pass on every 500ms subtick. This guarantees that items created or spawned by an admin exist on the map before frogs act in the same tick.

- `actorId = 0` is the system sentinel for admin-queued god actions
- God actions are dispatched via `GOD_ACTION_REGISTRY` in `server/actions/index.ts`
- Handlers implement `GodActionHandler` from `server/actions/god_types.ts` — no frog context, no fumble, no turn consumption
- If a god action fails validation it is marked `cancelled`; if the handler type is unknown it is marked `resolved` and skipped

---

## 1. Transport Layer: tRPC (Admin Path)

The client is configured in `client/src/main.tsx` with an `httpBatchLink` pointing at `/api/trpc`, using `superjson` as the transformer to handle complex types (Dates, Maps, etc.).

The two endpoints on `adminRouter` that queue game actions are:

### `admin.submitActionForFrog`
Generic action queue — used for inventory actions like EQUIP, UNEQUIP, and GIVE.

```typescript
// Input
{
  frogId: number,
  actionType: string,          // "EQUIP" | "UNEQUIP" | "GIVE" | ...
  payload?: Record<string, unknown>  // e.g. { itemId: "abc-123" }
}

// Response
{ queued: true, pendingActionId: number }
```

### `admin.submitMovementForFrog`
Movement-specific endpoint that runs a pre-validation check (Chebyshev distance + terrain cost) before queuing.

```typescript
// Input
{
  frogId: number,
  actionType: "STEP" | "HOP" | "DASH",
  targetGridX: number,
  targetGridY: number
}

// Response
{ queued: true, pendingActionId: number }
// or an error if pre-validation fails
```

---

## 2. Admin UI Components That Trigger Actions

### `InventoryTab.tsx` — Item Actions

`client/src/components/admin/InventoryTab.tsx` calls `trpc.admin.submitActionForFrog` for three action types:

```typescript
// Equip an item from inventory or the ground
submitAction.mutate({ frogId, actionType: "EQUIP", payload: { itemId } })

// Unequip an item back to inventory
submitAction.mutate({ frogId, actionType: "UNEQUIP", payload: { itemId } })

// Pick up an item from the ground
submitAction.mutate({ frogId, actionType: "GIVE", payload: { itemId } })
```

After a successful mutation, the component adds the frog to a `pendingFrogs` Set, which disables further action buttons for that frog. The lock releases when the next `ENGINE_TICK` WebSocket message arrives (see §5).

### `VisionTab` inside `Admin.tsx` — Movement Actions

The vision panel calls `trpc.admin.submitMovementForFrog` when the user selects a tile and clicks a move button:

```typescript
submitMove.mutate({
  frogId: selectedFrogId,
  actionType: "STEP",   // or "HOP"
  targetGridX,
  targetGridY,
})
```

The `ActionBar` component renders the movement buttons and computes whether the selected tile is in range using Chebyshev distance.

---

## 3. Server: Receiving & Queuing (`server/routers/admin.ts`)

Both admin action endpoints call `createPendingAction()`, which inserts a row into the `pending_actions` table:

```typescript
await createPendingAction({
  actorId: frogId,
  actionType,                              // e.g. "EQUIP"
  resolveBucket: Math.floor(Date.now() / 500),  // which 500ms window
  payload: payload ?? {},
  targetGridX,   // only for movement
  targetGridY,
})
```

**`resolveBucket`** is the key scheduling mechanism. It's the current Unix timestamp in milliseconds divided by 500, rounded down. The heartbeat engine processes all actions whose bucket is ≤ the current bucket on each subtick.

### `pending_actions` table schema

```
id              serial (PK)
actorId         integer          — frog performing the action
actionType      varchar(64)      — "EQUIP", "STEP", "HOP", etc.
targetGridX     integer?         — for spatial actions
targetGridY     integer?
resolveBucket   bigint           — Math.floor(Date.now() / 500)
payload         jsonb            — { itemId?, targetFrogId?, ... }
status          enum             — "pending" | "resolved" | "cancelled"
resolvedAt      timestamp?
createdAt       timestamp
```

Indexes are on `(resolveBucket, status)` for efficient tick polling and `(status, resolvedAt)` for the nightly purge.

---

## 4. Heartbeat Engine & Resolution

**File:** `server/engine/tickProcessor.ts`, orchestrated by `server/websockets/socket.ts`

The heartbeat runs on two cadences:

- **500ms subtick** — calls `processAllActions(notifyFn)`, broadcasts `ENGINE_QUIVER`
- **10s main tick** — broadcasts `ENGINE_TICK` to all clients, purges resolved rows

### `processAllActions()` inside each 500ms subtick

```
1. Fetch all pending_actions where resolveBucket <= currentBucket and status = "pending"
2. Sort by frog DEX descending (higher DEX acts first; ties broken by DB insertion order)
3. For each action row:
   a. Skip FUMBLE sentinels (mark as resolved, continue)
   b. Call runAction(ctx, notifyFn)
   c. Mark the row as status = "resolved", resolvedAt = now()
```

### `runAction()` gates (`server/actions/index.ts`)

Every action passes through three sequential gates before executing:

| Gate | Check | On failure |
|------|-------|------------|
| 1. Dedup | `hasFrogActedThisHeartbeat(frogId)` — was this frog's turn already consumed? | Silent reject — row resolved, no effect |
| 2. Frog alive | `getFrogById(frogId)` — exists and not dead? | Silent reject |
| 3. Handler validate | `handler.validate(ctx)` — action-specific rules | See below |

**Two types of validation failure:**

- **Silent reject** (`ok: false`, no `code`) — the frog's turn is *preserved*. Structural errors (wrong state, bad coords) fall here. The action was likely stale or invalid before it could matter.
- **FUMBLE** (`ok: false, code: "FUMBLE"`) — the frog's turn is *consumed*. A FUMBLE sentinel row is inserted so `hasFrogActedThisHeartbeat()` blocks any remaining actions this tick. Used for game-meaningful failures (equip slot full, throwing something blocked by an item's `blockedActions` list).

If `validate()` returns `ok: true`, the engine calls `handler.execute()` then `handler.broadcast()`.

---

## 5. Action Registry & Handlers (`server/actions/`)

The dispatcher looks up handlers by action type string:

```typescript
// server/actions/index.ts
const ACTION_REGISTRY: Record<string, ActionHandler> = {
  STEP:       stepHandler,
  HOP:        hopHandler,
  EQUIP:      equipHandler,
  UNEQUIP:    unequipHandler,
  THROW:      throwHandler,
  STORE_ITEM: storeHandler,
  GIVE:       giveHandler,
};
```

Each handler implements:

```typescript
interface ActionHandler {
  validate(ctx: ActionContext): Promise<ValidationResult>
  execute(ctx: ActionContext):  Promise<ExecuteResult>
  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): Promise<void>
}
```

`ActionContext` carries the pending_action row data plus the hydrated frog object (populated by `runAction()` between gates 2 and 3).

The `broadcast()` phase does two things:
1. Calls `pushActionLog()` — feeds the ephemeral action feed sent to clients as `SUBTICK_LOGS`
2. Calls `notify(userId, data)` — sends an immediate WebSocket message to the specific player (e.g. `ITEM_EQUIPPED`, `ACTION_RESOLVED`)

---

## 6. Client Notification Loop

After an action resolves, the admin UI learns about it in two ways:

### Immediate player notification (WebSocket)
The handler's `broadcast()` phase sends a targeted message to the frog's owner:
```
{ type: "ITEM_EQUIPPED", itemId: "..." }
{ type: "ACTION_RESOLVED", legal: true, gridX: 5, gridY: 3 }
```
In admin mode this is less relevant since the admin may not be the frog's owner.

### Polling on ENGINE_TICK (tRPC refetch)
Every 10 seconds the server broadcasts:
```
{ type: "ENGINE_TICK", timestamp: number }
```
`InventoryTab` listens for this via WebSocket and on receipt calls:
```typescript
inventory.refetch()
equipped.refetch()
pendingFrogs.clear()   // unlock action buttons
```
This is why the admin UI shows "waiting for heartbeat" after submitting an action — it's waiting for the 10s cycle to confirm the resolved state.

---

## 7. End-to-End Example: EQUIP

```
1. Admin clicks "Equip" on item "550e8400..." for frog #42
   └─ InventoryTab.tsx: submitAction.mutate({ frogId: 42, actionType: "EQUIP", payload: { itemId: "550e8400..." } })

2. tRPC HTTP POST to /api/trpc
   Body: { "0": { method: "mutation", params: { path: "admin.submitActionForFrog", input: { frogId: 42, actionType: "EQUIP", payload: { itemId: "550e8400..." } } } } }

3. server/routers/admin.ts receives the mutation
   └─ createPendingAction({ actorId: 42, actionType: "EQUIP", resolveBucket: 4821434, payload: { itemId: "550e8400..." } })
   └─ INSERT INTO pending_actions ... status = "pending"
   └─ Returns { queued: true, pendingActionId: 99 }

4. Client receives response
   └─ pendingFrogs.add(42) — buttons disabled

5. ≤500ms later: heartbeat subtick fires
   └─ processAllActions() fetches pending rows for bucket 4821434
   └─ runAction() — gates pass (frog 42 alive, not yet acted)
   └─ equipHandler.validate(): item accessible? equip slots available? → ok: true
   └─ equipHandler.execute(): SET item status = "EQUIPPED", recalculate bonuses
   └─ equipHandler.broadcast(): pushActionLog("Frog equips ...") + notify(userId, { type: "ITEM_EQUIPPED" })
   └─ pending_action #99 → status = "resolved"

6. ≤10s later: main tick fires
   └─ broadcast({ type: "ENGINE_TICK", timestamp: ... })

7. InventoryTab receives ENGINE_TICK
   └─ inventory.refetch() + equipped.refetch()
   └─ pendingFrogs.clear() — buttons re-enabled
   └─ UI updates to show item in equipped slot
```

---

## 8. Quick Reference: All Admin Action Endpoints

| Tab | tRPC Endpoint | Action Types | Input Shape | Effect |
|-----|--------------|-------------|-------------|--------|
| Inventory | `admin.submitActionForFrog` | EQUIP | `{ frogId, "EQUIP", { itemId } }` | Queues to `pending_actions` |
| Inventory | `admin.submitActionForFrog` | UNEQUIP | `{ frogId, "UNEQUIP", { itemId } }` | Queues to `pending_actions` |
| Inventory | `admin.submitActionForFrog` | GIVE | `{ frogId, "GIVE", { itemId } }` | Queues to `pending_actions` |
| Vision | `admin.submitMovementForFrog` | STEP / HOP | `{ frogId, actionType, targetGridX, targetGridY }` | Pre-validates, then queues |
| Users | `admin.setUserRole` | — | `{ userId, role }` | Direct DB write |
| Frogs | `admin.createTestFrog` | — | `{ name, species, distributedStats }` | Direct DB write |
| Frogs | `admin.grantXp` | — | `{ frogId, amount }` | Direct DB write |
| Frogs | `admin.resurrectFrog` | — | `{ frogId }` | Direct DB write |
| Gods | `admin.setDivinePower` | — | `{ godId, amount }` | Direct DB write |
| World | `admin.spawnChunk` | — | `{ chunkX, chunkY, biome }` | Direct DB write |
| Items | `admin.spawnItem` | — | `{ name, rarityTier, stats, itemState, ... }` | Direct DB write |
| GamePage | `admin.submitItemActionForFrog` | SWING (any schema-driven) | `{ frogId, itemId, action, targetTiles }` | Deferred queue (cast_time_ms) |

Only the first five rows go through `pending_actions` and the heartbeat engine. The rest take effect immediately.

---

## 9. Item Action Submission Flow (Generic Intent Builder)

This flow handles schema-driven actions like SWING. It is invoked from the GamePage (not the Admin panel) via the `useItemIntentBuilder` hook.

```
Player clicks SWING button
    │
    └─► ActionBar.onAction(actionName, itemId, actionSchema)
            │
            └─► GamePage.handleAction() checks actionSchema != null
                    │
                    └─► intentBuilder.startTargeting(itemId, actionSchema)
                            └─► mode = "TARGETING"
                            └─► Viewport renders orange hover, red confirmed tiles

Player clicks tile (up to schema.targeting.count times)
    │
    └─► intentBuilder.handleTileClick(gridX, gridY)
            ├─ Client-side Chebyshev guard (dist > max_range → ignore, no penalty)
            ├─ Append tile to selectedTiles[]
            └─ If selectedTiles.length === count: auto-submit

──────────────────────────────────────────────────────────────────────────────
tRPC: admin.submitItemActionForFrog
──────────────────────────────────────────────────────────────────────────────
    │
    ├── Validate: frog exists, alive
    ├── Validate: item exists, is EQUIPPED by this frog
    ├── Validate: item.statsJson.actionSchema parses via ActionSchemaSchema
    ├── Validate: schema.action_name === input.action
    ├── Validate: targetTiles.length === schema.targeting.count
    ├── Validate: each tile ≤ max_range Chebyshev from frog (at submission time)
    │
    ├── Poise gate: hasPendingActionForFrog(frogId)?
    │       └─► YES → TRPCError BAD_REQUEST "Frog is in Poise"
    │
    └── Queue:
            actorId       = frogId
            actionType    = "SWING" (schema.action_name)
            resolveBucket = floor(Date.now() / 500) + ceil(cast_time_ms / 500)
            payload       = { itemId, targetTiles }
            status        = "pending"

    → Client receives { queued: true, resolvesInMs: 4000 }
    → setLockedIn(true) — ActionBar shows spinner

──────────────────────────────────────────────────────────────────────────────
4 seconds later: sub-tick fires (resolveBucket matches)
──────────────────────────────────────────────────────────────────────────────
    │
    └─► processAllActions() → runAction("SWING", ctx)
            │
            ├── Gate 1: hasFrogActedThisHeartbeat? → skip if already resolved this heartbeat
            ├── Gate 2: frog alive?
            │
            └─► swingHandler.validate()
                    ├─ item still EQUIPPED? (frog may have un-equipped during cast)
                    ├─ each tile still within max_range? (frog may have moved)
                    └─ checkItemFumble() — any EQUIPPED item blocking SWING?
                    
            └─► swingHandler.execute()
                    └─ for each target tile:
                        getFrogsAtTile(x, y)    → apply damage (str + equippedAttackBonus)
                        getPredatorsAtTile(x, y) → apply damage
                        (same entity = multiple tiles → multiple damage hits)
                        
            └─► swingHandler.broadcast()
                    ├─ pushActionLog per damaged entity (category: "combat")
                    └─ notify(ownerId, { type: "SWING_RESOLVED", targetTiles, damaged })

──────────────────────────────────────────────────────────────────────────────
10s macro-tick:
──────────────────────────────────────────────────────────────────────────────
    └─► ENGINE_TICK → client refetches vision, setLockedIn(false)
```

### Key Files for This Flow

| File | Role |
|------|------|
| `client/src/hooks/useItemIntentBuilder.ts` | Targeting state machine, auto-submit |
| `client/src/components/Viewport.tsx` | Canvas passes 5a (red) and 5b (orange) |
| `client/src/components/ActionBar.tsx` | TARGETING mode UI, cancel button |
| `client/src/pages/GamePage.tsx` | Wires hook → Viewport → ActionBar |
| `server/routers/admin.ts` → `submitItemActionForFrog` | Validation + deferred queue |
| `server/actions/swing.ts` | Execution + damage + broadcast |
| `server/db.ts` → `hasPendingActionForFrog` | Poise gate |
| `server/db.ts` → `getFrogsAtTile`, `getPredatorsAtTile` | AoE damage queries |
| `shared/game.schema.ts` → `ActionSchemaSchema` | Canonical targeting schema type |
