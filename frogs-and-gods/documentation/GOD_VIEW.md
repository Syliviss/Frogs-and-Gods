# Frogs & Gods — God's View

Reference for the God's View tab in the Admin/Developer panel. This is the primary gameplay interface for gods — a free-camera isometric viewport with a divine action bar.

---

## Overview

The God's View tab lives at `client/src/components/admin/GodViewTab.tsx` and is wired into `Admin.tsx` as the `"godview"` tab (between "Gods" and "World").

Unlike the Vision tab (which locks the camera to a specific frog), God's View uses a free-floating camera that pans the world by chunk. The viewport, action log, and action bar all respond to whichever god the admin has selected.

---

## Camera System

### Tick-Paced Chunk Navigation

The camera moves **one chunk at a time**, synchronized to the 10-second `ENGINE_TICK`. Clicking any of the 8 surrounding chunks in the viewport queues a `GOD_PAN` action. The pan does not apply immediately — it resolves on the next ENGINE_TICK via `useTickSync`.

Visual feedback: a purple status line below the header reads "↷ Pan queued to chunk (X, Y) — applying on next tick."

**Click routing logic** (`handleTileClick`):
1. If an active power is selected → route to `handleDivineTileClick`
2. If clicked chunk is a neighbor (`|dx| ≤ 1 && |dy| ≤ 1`, not center) → queue pan
3. Otherwise → set `selectedTile` (look panel)

### Instant Coordinate Teleport

A `chunkX / chunkY` input in the tab header allows immediate camera jumps. Press Enter or click "Go" — updates `cameraChunkX/Y` state directly, no tick delay. Dev convenience only.

### `GOD_PAN` Action

| | |
|--|--|
| **Action type** | `GOD_PAN` |
| **Registry** | `GOD_ACTION_REGISTRY` |
| **Handler** | `server/actions/god_pan.ts` |
| **Favor cost** | 0 |
| **Payload** | `{ godId, chunkX, chunkY }` |
| **Effect** | Pure event — logs "God's gaze shifts to chunk (X, Y)" to action log. No world mutation. |
| **Client** | `pendingPan` state in `GodViewTab` applies on next `useTickSync` callback. |

The reason `GOD_PAN` is a server action (not pure client-side): it follows the inhale/exhale invariant and provides an audit trail in `pending_actions`.

---

## Vision Query

**Endpoint:** `admin.getGodVision` (`server/routers/admin.ts`)

Takes `{ centerChunkX, centerChunkY }` and returns the same shape as `frog.getPlayerVision`:
```
{ chunks: Record<"cx:cy", string[][]>, frogs: Frog[], predators: Predator[], items: Item[] }
```

Fetches the same 3×3 chunk neighborhood using the same DB helpers (`getChunksByCoords`, `getFrogsInBounds`, `getPredatorsInChunkArea`, `getItemsInBounds`). `pixelData` is stripped from items — the client lazy-fetches it via `frog.getItemPixelData` exactly as the Vision tab does.

The query uses `keepPreviousData: true` to avoid a blank canvas flash during pan.

---

## Divine Action Bar

### Powers

Each god has up to 3 starting powers (set at creation). The action bar renders only the powers in the selected god's `startingPowers` array. All four possible powers cost **25 favor**:

| Power ID | Action type | Effect |
|----------|-------------|--------|
| `HEAL_FROG` | `DIV_HEAL_FROG` | Restore +25 HP to target frog (capped at maxHp) |
| `SMITE_ENEMY` | `DIV_SMITE_ENEMY` | Deal 50 damage to target predator; delete if lethal |
| `SPAWN_ITEM` | `DIV_SPAWN_ITEM` | Place a chosen item at target tile in GROUND state |
| `SPAWN_PREDATOR` | `DIV_SPAWN_PREDATOR` | Spawn a new predator at target tile |

### Targeting Flow

1. Admin clicks a power button → `activePower` state is set
2. A targeting prompt appears (right-click canvas to cancel)
3. `SPAWN_ITEM` reveals an item template dropdown; `SPAWN_PREDATOR` reveals Type/AI/HP/Speed controls
4. Admin clicks a tile → `handleDivineTileClick` fires
5. `submitDivineAction.mutate(...)` is called → `admin.submitDivineAction` endpoint
6. On success: `activePower` clears, `refetchGods()` refreshes the favor display
7. On error: error message shown, `activePower` clears

### Favor Deduction — End-to-End

```
1. submitDivineAction endpoint: validates god.favor >= 25 → inserts pending_actions row
   actorId = godId, actionType = DIV_*, payload includes godId
2. Next 500ms bucket: getPendingGodActions returns the row (DIV_* is in GOD_ACTION_TYPES)
3. Inhale: state.gods.set(godId, ...) loaded from DB
4. validate(): re-checks state.getGod(godId).favor >= 25 (prevents double-spend this tick)
5. execute(): pushes GOD_UPDATE { favor: favor-25, totalInterventions: +1 }
              pushes world effect instruction (FROG_UPDATE / PREDATOR_UPDATE / etc.)
              state.updateGod() mutates in-memory immediately
6. Exhale: UPDATE gods SET favor=..., total_interventions=... WHERE id=godId
7. ENGINE_TICK → refetchGods() → favor display updates
```

### Endpoint: `admin.submitDivineAction`

Input: `SubmitDivineActionSchema` (`shared/game.schema.ts`)

Key fields:
- `godId`: which god is acting
- `powerId`: the `DivinePowerId` enum value (UI-facing label)
- `targetGridX/Y`: tile coordinates for the effect
- `targetFrogId` / `targetPredatorId`: entity IDs for HEAL/SMITE
- `spawnItemTemplateId`: UUID of item to place (SPAWN_ITEM)
- `spawnEnemyType`, `spawnEnemyAiType`, `spawnEnemyHp`, `spawnEnemySpeed`: predator config (SPAWN_PREDATOR)

The endpoint maps `powerId → DIV_actionType` and embeds all necessary fields into `payload` before calling `createPendingAction`.

---

## Action Log

Uses the existing `useActionLogs(x, y)` hook with the camera-center absolute coordinates:
```ts
useActionLogs(cameraChunkX * 16, cameraChunkY * 16)
```

The hook filters `SUBTICK_LOGS` to entries within Chebyshev distance 24 of the given coordinates. As the camera pans, the log updates to reflect events near the new viewport center.

---

## Actor ID Safety

`DIV_*` and `GOD_PAN` action types are exclusively in `GOD_ACTION_TYPES` (`server/actions/_god_action_types.ts`). `getPendingGodActions()` queries `WHERE actionType IN GOD_ACTION_TYPES`, so these rows are guaranteed to be god-initiated — never confused with frog or predator actions, even though all three share the `actorId` integer column.

The god actor inhale in `tickProcessor.ts` filters `godActions` only:
```ts
const godActorIds = [...new Set(godActions.map(a => a.actorId).filter(id => id > 0))];
```

The `id > 0` guard excludes `actorId = 0` (system sentinel used by `CREATE_GOD`, `SPAWN_PREDATOR`, etc.).

---

## Key Files

| File | Role |
|------|------|
| `client/src/components/admin/GodViewTab.tsx` | Main tab component |
| `server/routers/admin.ts` | `getGodVision`, `submitDivineAction`, `submitGodPan` endpoints |
| `server/actions/divine_heal_frog.ts` | DIV_HEAL_FROG handler |
| `server/actions/divine_smite_enemy.ts` | DIV_SMITE_ENEMY handler |
| `server/actions/divine_spawn_item.ts` | DIV_SPAWN_ITEM handler |
| `server/actions/divine_spawn_predator.ts` | DIV_SPAWN_PREDATOR handler |
| `server/actions/god_pan.ts` | GOD_PAN handler |
| `server/actions/_god_action_types.ts` | `GOD_ACTION_TYPES` array (gates `getPendingGodActions` query) |
| `server/engine/types.ts` | `SimulatedState.gods` map + `GOD_UPDATE` instruction |
| `server/engine/tickProcessor.ts` | God inhale + GOD_UPDATE exhale |
| `shared/game.schema.ts` | `GetGodVisionSchema`, `SubmitDivineActionSchema`, `GodPanSchema` |
| `shared/divinePowers.ts` | `DIVINE_POWER_LIST` — authoritative list of power display names and types |
