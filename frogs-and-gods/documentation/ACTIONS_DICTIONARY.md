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

**CRITICAL — Object.assign mutation gotcha:** All `SimulatedState.updateX()` methods use `Object.assign(entity, changes)` — they mutate the existing object **in place**. If you call `state.updateFrog(id, { currentHp: 0 })` and then read `frog.currentHp` (where `frog` is a reference captured earlier), you will see `0`, not the original value. Always capture any field you need **before** calling `state.updateX()` if you plan to use it afterward:

```typescript
// WRONG — reads null after mutation
state.updateInstance(id, { tileDataJson: instance.stagedTileDataJson, stagedTileDataJson: null });
out.push({ changes: { tileDataJson: instance.stagedTileDataJson } });  // stagedTileDataJson is now null!

// CORRECT — capture first, then mutate
const stagedJson = instance.stagedTileDataJson!;
state.updateInstance(id, { tileDataJson: stagedJson, stagedTileDataJson: null });
out.push({ changes: { tileDataJson: stagedJson } });
```

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

### Movement handlers — `server/actions/_moveHelper.ts`

Three separate `ActionHandler` exports: `stepHandler`, `hopHandler`, `swimHandler`. Each is imported directly by `step.ts`, `hop.ts`, and `swim.ts`. All three use `rollConditionCheck`, `checkItemFumble`, and `getTerrainAt` from `_utils.ts`.

**POI wake side-effect:** after a frog moves, each handler's `execute()` calls `wakePoisNear()` — it emits a `POI_UPDATE { status: 0 }` for every overworld Point of Interest in the frog's new 3×3 chunk neighborhood, so the next POI heartbeat pass evaluates them. See `documentation/POI_SYSTEM.md`.

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

### PICKUP

| | |
|--|--|
| **File** | `server/actions/pickup.ts` |
| **Type** | item |
| **Distance** | Chebyshev 1 (own tile + 8 adjacent) |
| **Key rules** | Item must be `GROUND` within Chebyshev ≤ 1 of frog. Payload must include `itemId`. Sets item state to `INVENTORY`, assigns `ownerId = frog.id`. No bonus recalculation (unlike EQUIP). Universal — no equipment required. |
| **Fumble triggers** | Inventory capacity exceeded (`inventoryCapacity` slots full, default 6). Item's `blockedActions` includes `"PICKUP"`. |
| **UI** | "PICKUP (N)" dropdown button in ActionBar; populated by `frog.getNearbyGroundItems` query, refreshed on ENGINE_TICK. |

### CROAK

| | |
|--|--|
| **File** | `server/actions/croak.ts` |
| **Type** | frog (universal) |
| **Distance** | Self — no tile target required |
| **Key rules** | Always succeeds. Resets `currentBreath` to `maxBreath` (from `statsJson`). Falls back to 5 if `maxBreath` is absent (legacy rows). Universal — no equipment required. **Snake attraction (overworld only):** scans the 3×3 chunk area; with chance 20% (dense land ≥45%) or 3% (sparse) spawns a HUNTER snake on a random land tile. A spawned snake has a **10% chance** to carry one loot item drawn at random from the `SNAKE_LOOT` pool (`items` with `lootType = 'SNAKE_LOOT'` AND `itemState = 'VOID'`); the item is recorded in `predators.lootItems` and flipped to `itemState = 'PREDATOR'`. |
| **Fumble triggers** | None. |
| **State written** | `FROG_UPDATE { currentBreath }`; optionally `PREDATOR_INSERT` (snake) and `ITEM_UPDATE { itemState: PREDATOR }` (claimed loot). |
| **UI** | "CROAK" button in ActionBar universal row (teal border). |

### OPEN_DOOR

| | |
|--|--|
| **File** | `server/actions/open_door.ts` |
| **Type** | traversal |
| **Distance** | Own tile (no targeting) |
| **Key rules** | **Mode 1 — Enter (overworld):** Frog must be standing on a `lair_entrances` tile in the overworld (`instanceId = null`). The referenced instance must have a committed `tileDataJson`. Teleports frog to the instance's "D" tile local coords. **Mode 2 — Exit (lair):** Frog must have a non-null `instanceId` and must be standing on the local "D" tile within the lair grid. Teleports frog back to the overworld entrance tile. |
| **Fumble triggers** | None — fails silently (`ok: false`, no code) if conditions are not met. No turn consumed on silent reject. |
| **State written** | `FROG_UPDATE { instanceId, gridX, gridY }` — sets or clears `instanceId`, and updates tile coords. |

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
| **Distance** | Exactly **2 tiles** (Chebyshev 2 in a unit direction × 2) |
| **Terrain** | Both the intermediate tile (head + 1 step) and destination must be `#` (land). Any other tile (`^`, `≈`, `~`, `+`, `@`, `%`, `D`) blocks the move. |
| **Body shift** | intermediate → new `segments[0]`. **On a straight move:** old head → new `segments[1]` (body stays collinear). **On a turn** (new direction ≠ `statsJson.facing`): old `segments[0]` → new `segments[1]` (tail stays where it was, forming an L-shaped body). |
| **Facing** | Derived from the target coords in `execute()` and persisted as `statsJson.facing = {dx, dy}`. |
| **Key rules** | Direction must be a pure unit vector × 2 — e.g. `(2,0)`, `(2,2)`, `(0,-2)`. L-shapes like `(2,1)` are rejected. Updates `gridX`, `gridY`, `chunkX`, `chunkY`. |

### STRIKE

| | |
|--|--|
| **File** | `server/actions/strike.ts` |
| **Type** | combat |
| **Actor** | Snake |
| **Range** | Chebyshev ≤ **5** tiles |
| **Damage** | 7 flat (no variance) |
| **Key rules** | Target tile must not be water (`≈ + ~`) or a lily pad (`@ %`). On hit: applies 7 damage. If target dies: resets snake's `lastMealTick` (hunger clock reset), clears `wrapping`. If target survives: queues WRAP on the next sub-tick bucket and sets `predator.statsJson.wrapping` optimistically. Wrap applies at any range up to 5 tiles. |

### WRAP

| | |
|--|--|
| **File** | `server/actions/wrap.ts` |
| **Type** | status |
| **Actor** | Snake |
| **Key rules** | On success: snake body **teleports** to 3 connected `#` tiles adjacent to the target frog — head placed on the nearest **cardinal** neighbor (N/S/E/W) to the snake's original position, then 2 more clockwise `[cardinal → diagonal → cardinal]`, forming a guaranteed L-shape around the frog. Sets `predator.statsJson.wrapping = { targetFrogId }` and `frog.statsJson.wrappedBy = predatorId` canonically. Both fields must be cleared together. A wrapped frog that attempts any action triggers `rollConditionCheck()` — **escape roll: `Math.max(frog.str, frog.dex) >= 15`**. Failed escape = FUMBLE (turn consumed, frog still wrapped). A frog with both STR < 15 and DEX < 15 cannot escape without stat growth or divine intervention. |

### CRUSH

| | |
|--|--|
| **File** | `server/actions/crush.ts` |
| **Type** | combat |
| **Actor** | Golem |
| **Range** | Chebyshev ≤ **2** from the nearest golem tile to target (i.e., Chebyshev ≤ 3 from golem center) |
| **Damage** | 15 flat to **all frogs in the crush zone** |
| **Crush zone** | Lines from the 3 nearest golem tiles to the target tile (via `getLineTiles`), deduplicated. All unique frogs on any zone tile take 15 damage. |
| **Key rules** | Double-validation: if no frog is on the primary target tile at resolution → FUMBLE (turn consumed). On kill of primary target: golem's `lastMealTick` is updated and the golem repositions — the nearest golem tile slides to the dead frog's tile, shifting the whole 3×3 grid by the same offset. If primary target survives, golem stays put. No follow-up action queued. |
| **Fumble triggers** | Primary target frog absent from tile at resolution time. |
| **Action log** | One `"Golem CRUSHES {name} for 15 dmg"` entry per hit frog. On kill + reposition: additional `"The golem advances onto the remains of {name}."` entry at new golem position. |
| **WS notify** | `{ type: "GOLEM_CRUSH", damage: 15, newHp, killed }` — sent to each hit frog's owner. |

---

## God Actions (GOD_ACTION_REGISTRY, actorId = 0)

God actions have no frog actor. They run in Pass 1 (before all other actions) and cannot fumble or consume a player turn.

### CREATE_FROG

| | |
|--|--|
| **File** | `server/actions/create_frog.ts` |
| **Key rules** | Queued via `frog.create` tRPC mutation (actorId=0, userId in payload). Optionally takes a `lairInstanceId` — if provided, the frog spawns within 5 tiles of the closest `≈` tile near the lair entrance (see `_spawnUtils.ts`). If no lair given, the frog spawns at a deterministic world-edge tile derived from the userId hash. Validates that the user has no existing living frog in `state.frogs`. Applies species stat modifiers, generates a sprite via `generateFrogPixelData(species)`, pushes a `FROG_INSERT` UpdateInstruction. |
| **Inhale** | Section D: loads user's existing frogs via `getFrogsByOwnerId`; if `lairInstanceId` given, loads lair entrance + 15-tile neighborhood chunks; otherwise loads edge tile chunk. |
| **Broadcast** | On success: pushActionLog. On failure: pushActionLog + `notify(userId, { type: "CREATE_FROG_FAILED", reason })`. |
| **Fumble** | No fumble (god action — no turn to consume). Validation failure → ACTION_CANCEL + `CREATE_FROG_FAILED` WS message. |

### CREATE_GOD

| | |
|--|--|
| **File** | `server/actions/create_god.ts` |
| **Key rules** | Inserts a new god row with `userId = null` (admin-created system gods have no user account). `favor` starts at 100. `startingPowers` must be an array of exactly 3 unique IDs from `DIVINE_POWER_LIST` (`shared/divinePowers.ts`). Validates with `CreateGodPayloadSchema`. Queued via `admin.createGod` tRPC mutation. |

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
| **Key rules** | Hard-deletes the predator row by ID. Not a combat death — no XP, no death event. Any items in `predators.lootItems` are dropped to `itemState = 'GROUND'` at the snake's head tile via `dropPredatorLoot()`. Used for divine removal from the admin panel. |

---

## Divine Intervention Actions (GOD_ACTION_REGISTRY, actorId = godId)

These actions are initiated by a specific god (not the system sentinel). `actorId = godId` (positive integer). Each deducts **25 favor** from the acting god on resolution and increments `totalInterventions`. The god row is pre-loaded into `state.gods` during the Inhale. `godId` is embedded in the action `payload` at queue time (since `GodActionContext` does not expose `actorId` directly).

### DIV_HEAL_FROG

| | |
|--|--|
| **File** | `server/actions/divine_heal_frog.ts` |
| **Favor cost** | 25 |
| **Key rules** | `payload.targetFrogId` must be a live (non-dead) frog in SimulatedState. Heals +25 HP capped at `statsJson.maxHp`. Queued via `admin.submitDivineAction` with `powerId: "HEAL_FROG"`. |
| **Validation** | God must have `favor >= 25`. Frog must exist and not be dead. |

### DIV_SMITE_ENEMY

| | |
|--|--|
| **File** | `server/actions/divine_smite_enemy.ts` |
| **Favor cost** | 25 |
| **Key rules** | `payload.targetPredatorId` must be a predator with `currentHp > 0` in SimulatedState. Deals 50 flat damage — deletes predator row if lethal (pushes `PREDATOR_DELETE`), otherwise pushes `PREDATOR_UPDATE`. |
| **Validation** | God must have `favor >= 25`. Predator must exist and be alive. |

### DIV_SPAWN_ITEM

| | |
|--|--|
| **File** | `server/actions/divine_spawn_item.ts` |
| **Favor cost** | 25 |
| **Key rules** | `payload.itemId` (UUID) must be an existing item in SimulatedState (pre-loaded via `godPayloadItemIds` in the Inhale). Places it at `payload.targetX/targetY` in `GROUND` state. Target chunk must exist. Queued via `admin.submitDivineAction` with `powerId: "SPAWN_ITEM"` + `spawnItemTemplateId`. |

### DIV_SPAWN_PREDATOR

| | |
|--|--|
| **File** | `server/actions/divine_spawn_predator.ts` |
| **Favor cost** | 25 |
| **Key rules** | Inserts a new predator at `payload.gridX/Y`. Validates against `SpawnPredatorPayloadSchema`. Target tile must exist and not be deep water. Queued via `admin.submitDivineAction` with `powerId: "SPAWN_PREDATOR"` + enemy config. |

### GOD_PAN

| | |
|--|--|
| **File** | `server/actions/god_pan.ts` |
| **Favor cost** | 0 |
| **Key rules** | Pure event — validates god exists and chunk coordinates are within ±312. `execute()` is a no-op; no world state mutated. Logs a "God's gaze shifts" action log entry. Camera update is applied client-side in `GodViewTab` on the next `ENGINE_TICK` via `useTickSync`. Queued via `admin.submitGodPan`. |

---

## Lair Actions (GOD_ACTION_REGISTRY — instanced dungeon system)

Lair actions manage instanced 16×16 dungeon maps owned by gods. Each god can own multiple lairs; frogs enter via `OPEN_DOOR` on the overworld entrance tile.

### DIV_UPDATE_LAIR

| | |
|--|--|
| **File** | `server/actions/div_update_lair.ts` |
| **Favor cost** | 5 favor × number of tiles changed vs committed layout. First save (no committed layout): free (changedTiles = 0 when `tileDataJson` is null). |
| **Key rules** | Payload: `{ godId, instanceId }`. Tile data is **pre-staged** — the tRPC mutation `admin.stageLairTileData` writes the 16×16 grid to `instance.stagedTileDataJson` before queuing this action. The handler reads `stagedTileDataJson` from `state.instances`, validates it, then promotes it to `tileDataJson` via `INSTANCE_UPDATE`. Grid must be 16×16. Exactly 1 "D" tile required. Cost is 0 if `tileDataJson` is null (first save). |
| **State written** | `GOD_UPDATE { favor }` (if cost > 0) + `INSTANCE_UPDATE { tileDataJson: stagedJson, stagedTileDataJson: null }` |
| **Queued via** | `admin.stageLairTileData` (stages data + queues action in one atomic tRPC call) |

#### Full Two-Phase Pipeline

```
Phase 1 — tRPC stageLairTileData (synchronous, happens immediately on button click):
  1. Validate 16×16 grid + exactly one "D" tile (Zod refine).
  2. If no instanceId: INSERT new instances row with stagedTileDataJson = grid JSON.
     If instanceId given: UPDATE instances SET staged_tile_data_json = grid JSON.
  3. INSERT pending_actions row: actionType="DIV_UPDATE_LAIR", payload={godId, instanceId},
     resolveBucket = Math.floor(Date.now() / 500).
  4. Return { instanceId, pendingActionId } to client.

  DB state: tileDataJson = null, stagedTileDataJson = "<grid JSON>"
  UI shows:  "⏳ Staged — awaiting next heartbeat"

Phase 2 — Heartbeat Inhale (≤10s later):
  tickProcessor Inhale Section A collects instanceId from god action payloads,
  calls getInstancesByIds([instanceId]) → loads Instance into state.instances.
  The loaded object has stagedTileDataJson = the grid JSON string.

Phase 3 — DIV_UPDATE_LAIR validate():
  - Reads instance from state.instances. Fails if missing or ownerGodId mismatch.
  - parseGrid(instance.stagedTileDataJson) — fails if null or not 16×16.
  - countTile(staged, "D") must equal 1.
  - Computes changedTiles vs tileDataJson (0 if tileDataJson is null).
  - Checks god.favor >= cost.

Phase 4 — DIV_UPDATE_LAIR execute():
  IMPORTANT: capture stagedJson = instance.stagedTileDataJson BEFORE calling
  state.updateInstance(). SimulatedState.updateInstance() uses Object.assign()
  which mutates the object in place — reading instance.stagedTileDataJson after
  the call returns null, causing the INSTANCE_UPDATE to write null to tileDataJson.

  Correct order:
    const stagedJson = instance.stagedTileDataJson!;   // capture first
    state.updateInstance(instanceId, { tileDataJson: stagedJson, ... });
    out.push({ type: "INSTANCE_UPDATE", changes: { tileDataJson: stagedJson, ... } });

Phase 5 — Great Exhale:
  tx.update(instances).set({ tileDataJson: stagedJson, stagedTileDataJson: null })
    .where(eq(instances.id, instanceId));

  DB state: tileDataJson = "<grid JSON>", stagedTileDataJson = null
  UI shows:  "✓ Committed — <time>"
```

### DIV_PLACE_LAIR

| | |
|--|--|
| **File** | `server/actions/div_place_lair.ts` |
| **Favor cost** | 0 (first entrance for this god); 50 favor (every subsequent placement) |
| **Key rules** | Payload: `{ godId, instanceId, targetGridX, targetGridY }`. Instance must have a committed `tileDataJson` (layout finalized via DIV_UPDATE_LAIR first). Target tile must be unclaimed (not in `state.lairEntrances`) and not deep water (`≈`). First-vs-repeat detection: counts all existing `lairEntrances` values whose instance's `ownerGodId` matches — loaded during Inhale Section C. |
| **State written** | `LAIR_ENTRANCE_INSERT { instanceId, gridX, gridY }` + `WORLD_MAP_OVERRIDE_INSERT { gridX, gridY, newChar: "D" }` + `GOD_UPDATE { favor }` (if cost > 0) |
| **Queued via** | `admin.submitDivPlaceLair` |

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
