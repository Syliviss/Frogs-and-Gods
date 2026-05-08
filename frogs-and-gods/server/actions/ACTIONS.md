# Frogs & Gods — Action Library Reference

> **For Claude agents**: This file is the canonical registry for the Action Library.
> When implementing a new action, follow the steps in "How to Add a New Action" below.
> Update BOTH the appropriate action table AND the ACTIONS.md when you make changes.

---

## All Actions (Implemented)

| Action     | Type     | File                            | Description                                    |
|------------|----------|---------------------------------|------------------------------------------------|
| STEP       | movement | `server/actions/step.ts`        | Move 1 tile (Chebyshev distance 1)             |
| HOP        | movement | `server/actions/hop.ts`         | Move 2 tiles (Chebyshev distance 2)            |
| EQUIP      | item     | `server/actions/equip.ts`       | Pick up/equip an item from ground or inventory |
| THROW      | item     | `server/actions/throw.ts`       | Throw a held item to a ground tile (range 3)   |
| STORE_ITEM | item     | `server/actions/store.ts`       | Place an item inside a CONTAINER item          |

## God / Admin Actions (Implemented)

These actions have no frog actor. They are dispatched by `processGodActions()` in `tickProcessor.ts` **before** the frog DEX pass. Handlers implement `GodActionHandler` from `./_types` — not `ActionHandler`. Use `GOD_ACTION_REGISTRY` in `index.ts`, not `ACTION_REGISTRY`.

| Action      | Type  | File                             | Description                                          |
|-------------|-------|----------------------------------|------------------------------------------------------|
| CREATE_ITEM | god   | `server/actions/create_item.ts` | Creates a new item row in VOID state (no world pos)  |
| SPAWN_ITEM  | god   | `server/actions/spawn_item.ts`  | Places an existing VOID item on the map as GROUND    |

`actorId = 0` is the system sentinel for admin-queued god actions. God actions cannot Fumble and do not consume a turn.

## Upcoming Actions (Not Yet Implemented)

| Action | Type     | Description                                             |
|--------|----------|---------------------------------------------------------|
| DASH   | movement | Fast 3-tile move that costs mana                        |
| SPIT   | item     | Drop a single item from inventory to ground at feet     |
| ATTACK | combat   | Melee strike at an adjacent frog or predator            |
| CAST   | magic    | Spend mana to trigger a spell from an EQUIPPED item     |

---

## How to Add a New Frog Action

1. **Create the file** at `server/actions/<action_name_lowercase>.ts`
2. **Export a named handler** that satisfies `ActionHandler` from `./_types.ts`
3. **Register it** in `server/actions/index.ts` → `ACTION_REGISTRY`
4. **Add a Zod input schema** in `shared/game.schema.ts` (e.g. `SprintActionSchema`)
5. **Update this file**: add a row to "All Actions", remove it from "Upcoming Actions" if it was listed
6. **Handle it in `socket.ts`** if it requires special pre-queue validation (ownership checks, etc.)

## How to Add a New God Action

1. **Create the file** at `server/actions/<action_name_lowercase>.ts`
2. **Export a named handler** that satisfies `GodActionHandler` from `./god_types.ts` (no frog context)
3. **Add the action type** to `GOD_ACTION_TYPES` in `./_god_action_types.ts`
4. **Register it** in `server/actions/index.ts` → `GOD_ACTION_REGISTRY`
5. **Add a Zod payload schema** in `shared/game.schema.ts`
6. **Add a tRPC mutation** in `server/routers/admin.ts` that calls `createPendingAction` with `actorId: 0`
7. **Update this file**: add a row to "God / Admin Actions"

---

## Action Contract

Every action file must export a single `ActionHandler` object with three async methods:

```typescript
import type { ActionHandler } from "./_types";

export const myActionHandler: ActionHandler = {
  // @param ctx.frog        - pre-resolved Frog row (never null here)
  // @param ctx.payload     - typed payload from the client message
  // @param ctx.targetGridX/Y - optional tile target
  // @returns FUMBLE code to consume the turn; other failures are silent
  async validate(ctx) { ... },

  // Only called when validate() returns { ok: true }
  // Must write final state to the DB (source of truth)
  async execute(ctx) { ... },

  // Publishes to the ephemeral action log and notifies the owning user via WS
  async broadcast(ctx, result, notify) { ... },
};
```

---

## Fumble Rules

A **Fumble** consumes the actor's turn for the entire 10-second heartbeat.

| Trigger                                   | Returns                        |
|-------------------------------------------|--------------------------------|
| Equip capacity exceeded (`equipCapacity`) | `{ ok: false, code: "FUMBLE" }` |
| Inventory capacity exceeded (`inventoryCapacity`) | `{ ok: false, code: "FUMBLE" }` |
| Storing a CONTAINER inside a CONTAINER    | `{ ok: false, code: "FUMBLE" }` |
| Item's `blockedActions` contains the action type | `{ ok: false, code: "FUMBLE" }` |

When `validate()` returns a FUMBLE code, `runAction()` in `index.ts` will:
1. Broadcast the fumble message via `pushActionLog`
2. Insert a sentinel `resolved` pending_action into the DB
3. The `hasFrogActedThisHeartbeat()` check will then block all further actions from this frog until the next 10-second heartbeat

**Non-fumble failures** (wrong range, item not found, wrong target) return `{ ok: false }` with no code
and do NOT consume the turn.

---

## Item-Based Fumble Check (Required in Every Action)

Every `validate()` must call `checkItemFumble()` from `./_types.ts`:

```typescript
import { checkItemFumble } from "./_types";

// Inside validate():
const equipped = await getEquippedItemsByFrogId(frog.id);
const fumble   = await checkItemFumble(frog.id, "MY_ACTION", equipped);
if (fumble) return fumble;
```

This scans the frog's items for any `statsJson.blockedActions` array containing the current
action type. No items currently block anything — this hook exists for future cursed/enchanted items.

---

## Key File Paths

| Purpose                   | File                                      |
|---------------------------|-------------------------------------------|
| Action contract types     | `server/actions/_types.ts`               |
| Registry + fumble guard   | `server/actions/index.ts`                |
| Shared movement logic     | `server/actions/_moveHelper.ts`          |
| Heartbeat-acted check     | `server/db.ts` → `hasFrogActedThisHeartbeat()` |
| Sub-tick processor        | `server/engine/tickProcessor.ts`         |
| WS action routing         | `server/websockets/socket.ts`            |
| Zod input schemas         | `shared/game.schema.ts`                  |
| DB item helpers           | `server/db.ts` → `getItemById`, `updateItem`, etc. |
