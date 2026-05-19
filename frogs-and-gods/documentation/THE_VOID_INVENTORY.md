# The Void Inventory

*In Frogs & Gods, items begin their existence in the VOID state — present in the database, but not yet placed in the world. This file catalogs code in the same condition: defined, typed, committed, and waiting. Ghost functions, dead enum values, stub systems, and architectural debts that haven't been resolved yet.*

---

## Ghost Enum Values

Code that is fully typed and schema-defined but has no behavioral implementation.

### `FLY` (enemyTypeEnum)

- **Defined in:** `drizzle/schema.ts` (`enemyTypeEnum: ["SNAKE", "FLY"]`), `shared/game.schema.ts` (`EnemyTypeSchema`)
- **Missing:** `server/entities/fly.ts` brain file, FLY action handlers, routing branch in `server/entities/index.ts`, PREDATOR_ACTION_REGISTRY entries
- **Current behavior if spawned via admin:** Row is inserted successfully. At `cycle_start`, `processEntityIntents()` routes by `enemyType` — FLY has no branch, so it is silently skipped. The predator sits idle indefinitely, never moves, never attacks.
- **Safe to leave:** Yes — it will never cause errors, it just does nothing.

### `DOCILE` and `REACTIVE` (aiTypeEnum)

- **Defined in:** `drizzle/schema.ts` (`aiTypeEnum: ["HUNTER", "REACTIVE", "DOCILE"]`), `shared/game.schema.ts`
- **Missing:** Any behavioral branching on `aiType` in `server/entities/snake.ts` or `server/entities/index.ts`
- **Current behavior:** A snake spawned as DOCILE or REACTIVE behaves identically to a HUNTER — `calculateSnakeIntent()` does not check `aiType`. All snakes hunt.

---

## Ghost Functions

Code that is defined and exported but not called in the live execution path.

### `runAction()` — `server/actions/index.ts`

`runAction()` is an exported standalone dispatcher with its own 3-gate logic (dedup → alive → validate/execute/broadcast). It was the original action dispatcher before the `SimulatedState` inhale/exhale pattern was introduced.

**Current status:** `tickProcessor.ts` imports `runAction` but never calls it. The tick processor dispatches directly to handler registries (`ACTION_REGISTRY`, `PREDATOR_ACTION_REGISTRY`, `GOD_ACTION_REGISTRY`) using `SimulatedState`. The `runAction` import in `tickProcessor.ts` is dead weight.

**Critical difference:** `runAction()` bypasses `SimulatedState`. If called, it would re-query the DB inside the tick resolution window and not see changes made by earlier actions in the same tick — exactly the race condition that inhale/exhale was designed to prevent. It also still inserts a FUMBLE sentinel row into `pending_actions` — the new tick processor does not do this.

**Do not use `runAction()` for new features.** Dispatch through the registries via `processAllActions()`.

### `checkItemFumble()` in `_types.ts` — duplicate

`server/actions/_types.ts` exports a version of `checkItemFumble(frogId, actionType, inventoryItems: Item[])` that takes a pre-loaded items array. All actual action handlers import `checkItemFumble` from `_utils.ts` instead (which takes `state: SimulatedState` and reads items itself). The `_types.ts` version appears unused.

### HEAL_FROG / SMITE_ENEMY WebSocket messages — `server/websockets/socket.ts`

Two WebSocket message types (`case "HEAL_FROG"`, `case "SMITE_ENEMY"`) bypass `pending_actions` entirely and emit directly to `worldLogEmitter`. They do not interact with game state (HP, predator existence, etc.) — they only produce log entries. This appears to be a vestige of an older intervention system that has not been removed or integrated into the action queue.

---

## Unmigrated Legacy Code

Code that violates the "never import from db in action handlers" architectural rule but still exists.

### `_conditionUtils.ts` — direct DB writes, not yet migrated

**File:** `server/actions/_conditionUtils.ts`

`rollConditionCheck()` here is the original async version of the condition check. It handles the full WRAP escape mechanic:
- On successful escape (max(str, dex) >= 15): directly calls `updatePredator()` and `updateFrog()` from `../db` to clear both `wrapping` and `wrappedBy` fields
- These are direct DB writes — they bypass `SimulatedState` and `UpdateInstruction[]`

**What this means:** The wrap escape path (`_conditionUtils.ts`) and the new movement validation path (`_utils.ts` + SimulatedState) are inconsistent. The `_utils.ts:rollConditionCheck(frog)` only checks if the frog is wrapped and returns a FUMBLE — it does not attempt the escape roll or clear the condition. The full escape mechanic is only implemented in `_conditionUtils.ts`.

If `_moveHelper.ts` is the only thing using `rollConditionCheck`, the wrap escape roll is currently unreachable in the new path. This needs investigation.

**Migration path:** Implement wrap escape inside `_moveHelper.ts:validate()` using SimulatedState mutations and `out.push({ type: "FROG_UPDATE", ... })` + `out.push({ type: "PREDATOR_UPDATE", ... })`.

---

## Undocumented Implemented Actions

Actions that are fully implemented and registered but were missing from the old `ACTIONS.txt`. Now documented in `ACTIONS_DICTIONARY.md`.

| Action | File | Was missing from |
|--------|------|-----------------|
| UNEQUIP | `server/actions/unequip.ts` | `documentation/ACTIONS.txt`, `server/actions/ACTIONS.md` |
| GIVE | `server/actions/give.ts` | `documentation/ACTIONS.txt`, `server/actions/ACTIONS.md` |

---

## Legacy Direct DB Writes

These admin mutations write directly to the database, bypassing `pending_actions` and the `SimulatedState` pipeline. This violates the architectural rule that all game state changes flow through the heartbeat engine.

They are admin-only and low-priority — they don't affect game integrity in normal play. However, if called during an active tick they could race with `SimulatedState` and cause the in-memory snapshot to be out of date for any actions resolving in the same 500ms window.

| Router | Mutation | What it bypasses |
|--------|----------|-----------------|
| `admin` | `grantXp` | Direct `updateFrog()` call |
| `admin` | `resurrectFrog` | Direct `updateFrog()` call |
| `admin` | `setDivinePower` | Direct `updateGod()` call |
| `admin` | `spawnChunk` | Direct `createWorldMapChunk()` call |

Migration path for each: wrap in a god action handler and queue via `pending_actions` with `actorId = 0`.

Note: `admin.createTestFrog` was migrated — it now queues `CREATE_FROG` through the pipeline (actorId=0, userId in payload).

---

## Planned but Unimplemented Actions

Listed as "upcoming" in old docs. No handler files exist.

| Action | Type | Planned mechanic |
|--------|------|-----------------|
| DASH | movement | 3-tile move that costs mana — faster than HOP but resource-gated |
| SPIT | item | Drop a single item from inventory to ground at the frog's own tile |
| ATTACK | combat | Melee strike at an adjacent frog or predator without requiring an equipped item |
| CAST | magic | Spend mana to trigger a spell defined by an EQUIPPED item's `actionSchema` |

---

## Partially Implemented Features

Features with working prototypes but known missing pieces.

### God's Lair — additional lair purchase flow

- **Implemented:** Schema supports 1:many lairs per god (`instances` table + `lairEntrances`). First lair is created via `admin.stageLairTileData` (no favor cost for layout, free first entrance). `OPEN_DOOR` frog action handles enter/exit traversal.
- **Unimplemented:** UI flow for a god to purchase a second (or third) lair with favor. The DB schema and isolation logic already handle multiple instances per god; only the purchase/unlock interaction is missing.
- **Current behavior:** Gods can technically create multiple instances via repeated calls to `stageLairTileData` (no cap enforced server-side). The 50-favor repeat placement gate only applies to `DIV_PLACE_LAIR` (entrance placement), not instance creation itself.

---

## Ghost Fields in PredatorStats

Fields typed in the `PredatorStats` interface that are never written or read anywhere in the codebase.

| Field | Type | Defined in | Status |
|-------|------|------------|--------|
| `statsJson.path` | `number[][]` | `server/actions/_types.ts` (PredatorStats) | Reserved for future pathfinding. No code writes it. No code reads it. |
| `statsJson.mutations` | `string[]` | `server/actions/_types.ts` (PredatorStats) | Reserved for future entity mutations. Never used. |

---

## Stub Systems

Systems that are partially scaffolded but have no active consumers.

### `server/storage.ts` — S3 Integration

An S3 client wrapper. Currently no active tRPC routes or action handlers import from it. The `server/_core/storageProxy.ts` proxies it but is also unused in the main game flow. Requires env vars (`S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) to activate.

### Auth Stubs — `protectedProcedure` / `adminProcedure`

Located in `server/_core/trpc.ts`. Both are defined as separate procedures but are currently identical to `publicProcedure` — no token validation, no session check. `ctx.user` always returns `null`. The game is a dev test-bed; real auth is a future concern.

Any code that checks `ctx.user` should be treated as always unauthenticated.

### `client/src/pages/GamePage.tsx`

The player-facing game view. Fully functional in isolation — renders the isometric Viewport, ActionBar, and action log. Wired to the `useItemIntentBuilder` SWING targeting hook. **Not yet player-facing** for these reasons:
- Route `/game` exists in `App.tsx` but there is no auth gate
- No session management (which frog is "yours"?)
- No public routing (players cannot find it without knowing the URL)

### `client/src/pages/TestingGround.tsx`

A dev scratch page. Not linked in any navigation. Not a route in `App.tsx`. Used for isolated component testing during development.

### `server/_core/` Stubs

Several files in `_core/` are scaffolded but not connected to any game feature:
- `imageGeneration.ts` — image generation client, no callers
- `llm.ts` — LLM integration client, no callers
- `notification.ts` — push notification stub, no callers
- `voiceTranscription.ts` — voice transcription stub, no callers

---

## In-Source Documentation Duplication

`server/actions/ACTIONS.md` is a partial action registry that lives inside the source tree. It was missing UNEQUIP, GIVE, SWING, all predator actions, and all god actions. It has been superseded by `documentation/ACTIONS_DICTIONARY.md`.

`server/actions/ACTIONS.md` has been updated to redirect to the canonical file.

---

## Database Assessment

From the deleted `DB_ASSESSMENT_TODO.md`, preserved here.

### Missing Referential Integrity

Columns `ownerId`, `partyId`, and `authorGodId` on several tables lack Drizzle `.references()` constraints. Orphaned records are possible if a referenced row is deleted without cascading cleanup.

### ~~Missing Spatial Indexes~~ — Resolved (migration 0002)

`frogs(grid_x, grid_y)`, `frogs(ownerId)`, `items(grid_x, grid_y)`, `items(owner_id, item_state)`, `pending_actions(actor_id, status)`, and `world_log_events(createdAt)` indexes were added in May 2026. See `documentation/SCALABILITY_ARCHITECTURE.md` for the full audit.

### Missing `chunkX` / `chunkY` on Frogs

`predators` store both `gridX/Y` and derived `chunkX/Y` for fast chunk-bounded queries. `frogs` only store `gridX/Y`, so every chunk-based frog lookup requires a computed division. Adding `chunkX/chunkY` columns to `frogs` (and updating them in every movement action's `UpdateInstruction`) would match the predator optimization.

### `pixelData` Bloat in Items Table

Each item stores a 256-element JSONB array of hex color strings on the main `items` row. Items that have no pixel art are `null`, but items with sprites add ~6KB per row. As the item economy grows, this will bloat join queries that only need item state or position. Mitigation: move `pixel_data` to a separate `item_sprites` table or offload to S3 (see storage stub above).

### `worldLogEvents` Unbounded Growth

`worldLogEvents` has no TTL, partitioning, or archival strategy. In a persistent game world with active frogs and predators, this table will grow continuously. Recommended: a scheduled purge job that deletes events older than N hours, or PostgreSQL table partitioning by timestamp.
