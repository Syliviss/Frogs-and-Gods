# Frogs & Gods — Actions Dictionary

Developer reference for every action handler. For the full action lifecycle (how actions get queued and resolved), see `ACTION_PATH.md`.

---

## Architecture: The Inhale-Exhale Pattern

Actions in Frogs & Gods do not query or write to the database directly. Instead they operate on a `SimulatedState` object — an in-memory snapshot of the relevant world slice for the current tick.

```
tickProcessor.ts
│
├── The Great Inhale
│     Bulk-fetch frogs, items, predators, chunks into SimulatedState
│
├── The Living Ledger
│     Actions sorted by initiative → each handler reads state, pushes UpdateInstruction[]
│     SimulatedState is mutated immediately so later actions see the updated world
│
└── The Great Exhale
      All UpdateInstructions written to DB in a single atomic transaction
```

**CRITICAL RULE:** Action handler files must **never** import from `../db`. Read world state from `state`. Write changes via `state.updateX()` and push to `out`. Any action that imports from `../db` breaks the inhale/exhale guarantee and can cause inconsistent tick resolution.

---

## The Action Handler Contract

All handler methods can be synchronous or async (`Promise<X> | X`). The tick processor awaits them either way.

### `ActionHandler` (frog actions)

```typescript
import type { ActionHandler } from "./_types";    // server/actions/_types.ts

export const myActionHandler: ActionHandler = {
  // Synchronous or async. Returns FUMBLE to consume the turn, { ok: false } to silently reject.
  // Never touches the DB — reads only from state.
  validate(ctx, state): ValidationResult {
    const fumble = checkItemFumble(ctx.frog!.id, "MY_ACTION", state);
    if (fumble) return fumble;
    return { ok: true };
  },

  // Only called when validate() returns ok: true.
  // Must write all changes to state AND push matching UpdateInstruction(s) to out.
  execute(ctx, state, out): ExecuteResult {
    state.updateFrog(ctx.frog!.id, { currentHp: 5 });
    out.push({ type: "FROG_UPDATE", id: ctx.frog!.id, changes: { currentHp: 5 } });
    return { success: true, data: { ... } };
  },

  // Fire-and-forget: push to action log + notify the owning user via WS.
  broadcast(ctx, result, notify): void { ... },
};
```

`ActionContext` carries the pending_action row data plus the hydrated frog row (populated by the tick processor before calling the handler). Returns `ValidationResult` (`.ok` field).

### `PredatorActionHandler` (predator actions)

Different signature — predator is passed explicitly alongside context:

```typescript
export const myPredatorHandler: PredatorActionHandler = {
  validate(ctx, predator, state): PredatorActionResult { ... },
  execute(ctx, predator, state, out): PredatorActionResult { ... },
  broadcast(ctx, predator, result, notify): void { ... },
};
```

Returns `PredatorActionResult` (`.success` field, not `.ok`). No fumble system — predator actions either succeed or are cancelled.

### `GodActionHandler` (god/admin actions)

```typescript
export const myGodHandler: GodActionHandler = {
  validate(ctx, state): GodActionResult { ... },
  execute(ctx, state, out): GodActionResult { ... },
  broadcast(ctx, result, notify): void { ... },
};
```

Returns `GodActionResult` (`.success` field, not `.ok`). No actor frog, no fumble, no turn consumption. On validation failure, the action is marked `cancelled`.

---

## Fumble Rules

A **Fumble** consumes the frog's turn for the entire 10-second heartbeat — no further actions resolve for that frog this cycle.

| Trigger | Condition |
|---------|-----------|
| Equip capacity exceeded | `equipCapacity` slots already full |
| Inventory capacity exceeded | `inventoryCapacity` slots already full |
| Container-in-container | Storing a CONTAINER inside another CONTAINER |
| Item blocks the action | `item.statsJson.blockedActions` includes this action type |

When a FUMBLE occurs in the tick processor, the original action row is marked `ACTION_RESOLVE` (resolved) and the frog's actor ID is added to `handledActorsThisTick`. No sentinel row is inserted — the in-memory set already blocks any remaining queued actions for that frog in the same tick batch.

**Non-fumble failures** (`ok: false`, no `code`) — turn NOT consumed. Used for structural errors: wrong range, item not found, stale coordinates. The player can queue again next heartbeat.

---

## Utility Library

All utilities live in `server/actions/_utils.ts`. Import them all from there.

### `checkItemFumble(frogId, actionType, state)` — `server/actions/_utils.ts`

Required call in every frog action's `validate()`. Scans all items owned by the frog in SimulatedState. Returns a FUMBLE `ValidationResult` if any item's `blockedActions` list includes the current action type, `null` otherwise.

```typescript
import { checkItemFumble } from "./_utils";

validate(ctx, state): ValidationResult {
  const fumble = checkItemFumble(ctx.frog!.id, "MY_ACTION", state);
  if (fumble) return fumble;
  // ... rest of validation
}
```

### `rollConditionCheck(frog)` — `server/actions/_utils.ts`

Checks whether the frog is subject to an active condition that should block the action. Returns `{ ok: false, code: "FUMBLE" }` if wrapped (or other future conditions), `{ ok: true }` otherwise. Call at the top of movement action `validate()`.

```typescript
import { rollConditionCheck } from "./_utils";

validate(ctx, state): ValidationResult {
  const condition = rollConditionCheck(ctx.frog!);
  if (!condition.ok) return condition;
}
```

> **Note:** The full wrap-escape mechanic (clearing `wrappedBy`/`wrapping` on successful escape) is still implemented in `_conditionUtils.ts` using direct DB writes. This file has not yet been migrated to the SimulatedState pattern. See `THE_VOID_INVENTORY.md`.

### `getEntitiesAt(state, gridX, gridY)` — `server/actions/_utils.ts`

Returns all live frogs, predators, and GROUND items at a given tile from SimulatedState.

```typescript
import { getEntitiesAt } from "./_utils";

const { frogs, predators, items } = getEntitiesAt(state, targetX, targetY);
```

### `getTerrainAt(state, gridX, gridY)` — `server/actions/_utils.ts`

Returns the `TileChar` at the given world coordinates by reading from `state.chunks`. Returns `"#"` (land) if the chunk is not loaded.

```typescript
import { getTerrainAt } from "./_utils";

const tile = getTerrainAt(state, ctx.targetGridX, ctx.targetGridY);
```

### `applyDamage(state, out, targetType, id, amount)` — `server/actions/_utils.ts`

Applies HP reduction to a frog or predator. Updates SimulatedState and pushes the appropriate `FROG_UPDATE` or `PREDATOR_UPDATE` instruction to `out`. For frogs, also pushes a `WORLD_LOG_INSERT` if the damage is lethal.

```typescript
import { applyDamage } from "./_utils";

applyDamage(state, out, "PREDATOR", predatorId, 7);   // 7 flat damage
applyDamage(state, out, "FROG",     frogId,     dmg); // variable damage
```

### `makeMoveHandler(actionType)` — `server/actions/_moveHelper.ts`

Factory function that returns a complete `ActionHandler` for a movement action type. `step.ts` and `hop.ts` both export `makeMoveHandler("STEP")` and `makeMoveHandler("HOP")` respectively. Uses `rollConditionCheck`, `checkItemFumble`, `getTerrainAt`, and `calculateRemainingMove` internally.

---

## Frog Actions (ACTION_REGISTRY)

### STEP

| | |
|--|--|
| **File** | `server/actions/step.ts` |
| **Type** | movement |
| **Distance** | Chebyshev 1 (adjacent tile, 8 directions) |
| **Key rules** | Calls `rollConditionCheck()` — WRAP condition can fumble this. Terrain cost must be within movement budget. |
| **Fumble triggers** | Any equipped item with `blockedActions: ["STEP"]`. WRAP escape fail. |

### HOP

| | |
|--|--|
| **File** | `server/actions/hop.ts` |
| **Type** | movement |
| **Distance** | Chebyshev 2 (2-tile jump) |
| **Key rules** | Same condition check as STEP. Higher terrain cost. Cannot land on deep water (≈). |
| **Fumble triggers** | Same as STEP. |

### EQUIP

| | |
|--|--|
| **File** | `server/actions/equip.ts` |
| **Type** | item |
| **Key rules** | Item must be on the ground at frog's tile OR in frog's inventory. Equip slot must have capacity. Sets item state to `EQUIPPED`, updates `ownerId`. |
| **Fumble triggers** | Equip capacity exceeded. Item's `blockedActions` includes `"EQUIP"`. |

### UNEQUIP

| | |
|--|--|
| **File** | `server/actions/unequip.ts` |
| **Type** | item |
| **Key rules** | Item must be currently EQUIPPED by this frog. Inventory must have capacity. Sets item state to `INVENTORY`. |
| **Fumble triggers** | Inventory capacity exceeded. Item's `blockedActions` includes `"UNEQUIP"`. |

### GIVE

| | |
|--|--|
| **File** | `server/actions/give.ts` |
| **Type** | item |
| **Key rules** | Item must be in frog's inventory. Target frog must be adjacent (Chebyshev 1). Target frog's inventory must have capacity. |
| **Fumble triggers** | Target frog's inventory capacity exceeded. Item's `blockedActions` includes `"GIVE"`. |

### STORE_ITEM

| | |
|--|--|
| **File** | `server/actions/store.ts` |
| **Type** | item |
| **Key rules** | Source item must be in frog's inventory. Target container must be in same inventory. Cannot store a CONTAINER inside a CONTAINER. |
| **Fumble triggers** | Container-in-container attempt. Item's `blockedActions` includes `"STORE_ITEM"`. |

### THROW

| | |
|--|--|
| **File** | `server/actions/throw.ts` |
| **Type** | item |
| **Distance** | Range 3 (Chebyshev) |
| **Key rules** | Item must be EQUIPPED or in inventory. Target tile must be within range. Sets item state to `GROUND` at target coords. |
| **Fumble triggers** | Item's `blockedActions` includes `"THROW"`. |

### SWING

| | |
|--|--|
| **File** | `server/actions/swing.ts` |
| **Type** | combat |
| **Distance** | Defined by item's `actionSchema.targeting.max_range` |
| **Key rules** | Item must be EQUIPPED. Uses Generic Intent Builder (deferred resolveBucket via `cast_time_ms`). Applies `str + equippedAttackBonus` damage to all entities at each target tile. Same entity on multiple tiles receives multiple hits. Re-validates item equipped and tile range at execution time (frog may have moved during cast). |
| **Fumble triggers** | `checkItemFumble()`. Item unequipped during cast = silent reject (not fumble). |

---

## Predator Actions (PREDATOR_ACTION_REGISTRY)

### SLITHER

| | |
|--|--|
| **File** | `server/actions/slither.ts` |
| **Type** | movement |
| **Actor** | Snake |
| **Key rules** | Moves head 1 Chebyshev step toward target. Shifts body: current head position → segments[0], segments[0] → segments[1] (tail dropped). Updates `gridX`, `gridY`, `chunkX`, `chunkY`. |

### STRIKE

| | |
|--|--|
| **File** | `server/actions/strike.ts` |
| **Type** | combat |
| **Actor** | Snake |
| **Damage** | 7 flat (no variance) |
| **Key rules** | Target frog must be adjacent (Chebyshev 1). On hit: applies 7 damage. If target dies (`newHp <= 0`): resets snake's `lastMealTick` to current heartbeat number (hunger clock reset). Optimistically sets `predator.statsJson.wrapping` — the WRAP action canonically confirms and enforces the constriction. |

### WRAP

| | |
|--|--|
| **File** | `server/actions/wrap.ts` |
| **Type** | status |
| **Actor** | Snake |
| **Key rules** | Sets `predator.statsJson.wrapping = { targetFrogId }` and `frog.statsJson.wrappedBy = predatorId` canonically. Both fields must be cleared together. A wrapped frog that attempts any action triggers `rollConditionCheck()` — **escape roll: `Math.max(frog.str, frog.dex) >= 15`**. Failed escape = FUMBLE (turn consumed, frog still wrapped). A frog with both STR < 15 and DEX < 15 cannot escape without stat growth or divine intervention. |

---

## God Actions (GOD_ACTION_REGISTRY, actorId = 0)

God actions have no frog actor. They run in Pass 1 (before all other actions) and cannot fumble or consume a player turn.

### CREATE_ITEM

| | |
|--|--|
| **File** | `server/actions/create_item.ts` |
| **Key rules** | Creates a new item row in `VOID` state (no world position, no owner). Item exists in the DB but is not accessible in the world until SPAWN_ITEM places it. |

### SPAWN_ITEM

| | |
|--|--|
| **File** | `server/actions/spawn_item.ts` |
| **Key rules** | Takes an existing item (any state) and places it at target world coordinates. Sets item state to `GROUND`, assigns `gridX/gridY`. |

### SPAWN_PREDATOR

| | |
|--|--|
| **File** | `server/actions/spawn.ts` |
| **Key rules** | Inserts a new predator row. Validates that the target tile exists and is not deep water (`≈`). Initializes `statsJson` with speed, segments (coiled at spawn point), and `wrapping: null`. |

### KILL_PREDATOR

| | |
|--|--|
| **File** | `server/actions/kill_predator.ts` |
| **Key rules** | Hard-deletes the predator row by ID. Not a combat death — no XP, no loot, no death event. Used for divine removal from the admin panel. |

---

## Planned / Unimplemented Actions

| Action | Type | Planned mechanic |
|--------|------|-----------------|
| DASH | movement | 3-tile move that costs mana |
| SPIT | item | Drop a single item from inventory to ground at the frog's feet |
| ATTACK | combat | Melee strike at an adjacent frog or predator (no item required) |
| CAST | magic | Spend mana to trigger a spell defined by an EQUIPPED item's `actionSchema` |

---

## How to Add a New Action

1. **Create** `server/actions/<action_name_lowercase>.ts`
2. **Export a named handler** satisfying `ActionHandler` (or `PredatorActionHandler` / `GodActionHandler`) from `./_types.ts`
3. **Write logic against SimulatedState only** — never import `../db`
4. **Call `checkItemFumble()`** at the top of `validate()` for all frog actions
5. **Register it** in `server/actions/index.ts` → the appropriate registry (`ACTION_REGISTRY`, `PREDATOR_ACTION_REGISTRY`, or `GOD_ACTION_REGISTRY`)
6. **Add a Zod input schema** in `shared/game.schema.ts` for the action's payload shape
7. **Update `ACTIONS_DICTIONARY.md`**: add a row, remove from "Planned" if it was listed there

If the new action needs to query an entity type not currently fetched by the inhale (e.g. a new DB table), add the bulk fetch and population step to `processAllActions()` in `server/engine/tickProcessor.ts`.
