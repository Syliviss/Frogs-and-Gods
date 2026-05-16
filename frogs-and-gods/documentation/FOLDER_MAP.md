# Frogs & Gods — Folder Map

Navigational reference for the project. Every folder and notable file, one line each.

---

## Root (`frogs-and-gods/`)

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts (yarn dev/build/check/test/format/db:push) |
| `tsconfig.json` | TypeScript config — covers `client/src`, `server`, `shared`; NOT `scripts/` |
| `vite.config.ts` | Frontend build config (React plugin, /api proxy to Express) |
| `vitest.config.ts` | Test runner config (node env, covers server + shared test files) |
| `drizzle.config.ts` | Drizzle ORM config (DATABASE_URL, schema path, migrations output) |
| `docker-compose.yml` | PostgreSQL 15 + pgAdmin container setup for local dev |
| `components.json` | shadcn/ui registry config (used by `npx shadcn add`) |
| `CLAUDE.md` | IDE guidance — commands, architecture notes, key invariants for Claude Code |
| `DIVINE_ASCII_ARCHITECTURE.md` | Canvas rendering architecture: DB → WebSocket → isometric canvas data path |
| `PROCEDURAL_GENERATION.md` | World terrain generation: Perlin noise pipeline, tile assignment, chunk seeding |
| `todo.md` | Project task list (partially stale — see `THE_VOID_INVENTORY.md`) |
| `yarn.lock` | Pinned dependency tree |

---

## `client/`

### `client/src/`

| File | Purpose |
|------|---------|
| `main.tsx` | React entrypoint — tRPC provider (httpBatchLink + superjson), router mount |
| `App.tsx` | wouter router: `/` → Admin, `/game` → GamePage, `/create-frog` → FrogCreationForm, `/map-studio` → MapStudio |
| `index.css` | Global styles — dark fantasy theme, Tailwind base |

### `client/src/components/`

| File | Purpose |
|------|---------|
| `Viewport.tsx` | HTML5 Canvas isometric renderer — 3×3 chunk view, click detection, item + frog sprite overlay, `frogSpriteManager` prop |
| `ActionBar.tsx` | Action button row — STEP/HOP/PICKUP dropdown/item-granted actions, TARGETING mode UI for SWING |
| `ActionLog.tsx` | Scrolling feed of resolved action events |
| `ErrorBoundary.tsx` | React error boundary for crash isolation |

#### `client/src/components/admin/`

| File | Purpose |
|------|---------|
| `InventoryTab.tsx` | Admin item management — equip/unequip/give actions, inventory display per frog |
| `EnemiesTab.tsx` | Admin predator panel — spawn/kill enemies, list active snakes |
| `WorldInspectorTab.tsx` | World inspector — 315×315 biome coverage canvas, chunk terrain viewer, POI registry list |
| `ImageDropZone.tsx` | Pixel art uploader — drag-and-drop 16×16 PNG → item pixel_data JSONB |
| `ItemStatsForm.tsx` | Admin item stats editor form |
| `GodViewTab.tsx` | God's View tab — free-camera isometric viewport, divine action bar, tick-paced pan, action log |
| `LairTab.tsx` | God's Lair tab — instance manager, 16×16 ASCII paint grid, palette, overworld entrance placer |

#### `client/src/components/ui/`

~55 shadcn/ui components (Radix primitives + Tailwind). Do not hand-edit — use `npx shadcn add <component>` to add new ones.

### `client/src/hooks/`

| File | Purpose |
|------|---------|
| `useWorldLog.ts` | WebSocket listener — subscribes to `WORLD_LOG` events from server |
| `useEngineLog.ts` | WebSocket listener — subscribes to `ENGINE_TICK` / `ENGINE_QUIVER` heartbeat events |
| `useActionLogs.ts` | Subscribes to `SUBTICK_LOGS` — action resolution feed from each 500ms sub-tick |
| `useItemIntentBuilder.ts` | Client-side state machine for SWING targeting (IDLE → TARGETING → auto-submit) |
| `useTickSync.ts` | Syncs local UI state to ENGINE_TICK cycle boundaries |
| `useComposition.ts` | UI composition helper |
| `useMobile.tsx` | Responsive breakpoint detection |
| `usePersistFn.ts` | Stable function reference across renders |

### `client/src/contexts/`

| File | Purpose |
|------|---------|
| `ThemeContext.tsx` | Dark/light theme provider |

### `client/src/lib/`

| File | Purpose |
|------|---------|
| `trpc.ts` | tRPC React client setup — `createTRPCReact<AppRouter>()`, httpBatchLink to `/api/trpc` |
| `SpriteManager.ts` | Sprite loader/cache (exported class + default `spriteManager` singleton) — converts pixel_data/modelJson arrays to baked Canvas elements; used for both items and frogs |
| `utils.ts` | Tailwind class merge utility (cn) |

### `client/src/pages/`

| File | Purpose |
|------|---------|
| `Admin.tsx` | Dev console — tabbed UI: Users, Frogs, Gods, God's View, World, Vision, Items, Inventory, Enemies, God's Lair, WorldLog, Engine |
| `GamePage.tsx` | Player-facing game view (functional but not yet live — see `THE_VOID_INVENTORY.md`) |
| `FrogCreationForm.tsx` | Character creation — name, species, stat distribution |
| `NotFound.tsx` | 404 page |
| `TestingGround.tsx` | Dev scratch page — linked from admin UX dropdown |
| `MapStudio.tsx` | Developer screenshot tool — large configurable isometric ASCII map canvas, PNG export; linked from admin UX dropdown |

---

## `server/`

### `server/_core/`

Bootstrap and infrastructure. Not game logic.

| File | Purpose |
|------|---------|
| `index.ts` | Express server entrypoint — mounts tRPC, WebSocket, Vite middleware |
| `trpc.ts` | tRPC procedure definitions — `publicProcedure`, `protectedProcedure`, `adminProcedure` (all identical stubs; auth not yet real) |
| `context.ts` | tRPC context factory — `user: null` always |
| `env.ts` | Environment variable validation (DATABASE_URL, etc.) |
| `vite.ts` | Vite dev-server middleware integration for SSR-like hot-reload |
| `dataApi.ts` | Internal data API helpers |
| `systemRouter.ts` | System-level tRPC endpoints (health, ping) |
| `imageGeneration.ts` | Image generation stub (not wired to game) |
| `llm.ts` | LLM integration stub (not wired to game) |
| `notification.ts` | Server-side notification stub |
| `storageProxy.ts` | S3/storage proxy stub (see `THE_VOID_INVENTORY.md`) |
| `voiceTranscription.ts` | Voice transcription stub |
| `types/manusTypes.ts` | Internal Manus assistant type definitions |

### `server/actions/`

Every action handler lives here. The central registry is `index.ts`.

| File | Purpose |
|------|---------|
| `_types.ts` | `ActionHandler` interface, `ActionContext`, `checkItemFumble()` utility |
| `_utils.ts` | Shared utilities: `getEntitiesAt()`, `applyDamage()` |
| `_conditionUtils.ts` | `rollConditionCheck()` — on-demand condition evaluation (WRAP escape, etc.) |
| `_moveHelper.ts` | `validateMove()` — shared movement validation used by STEP and HOP |
| `_god_action_types.ts` | `GOD_ACTION_TYPES` constant |
| `_predator_action_types.ts` | `PREDATOR_ACTION_TYPES` constant |
| `_predator_types.ts` | `PredatorActionHandler` interface |
| `god_types.ts` | `GodActionHandler` interface |
| `index.ts` | ACTION_REGISTRY, GOD_ACTION_REGISTRY, PREDATOR_ACTION_REGISTRY, `runAction()` (legacy) |
| `step.ts` | STEP — move 1 tile |
| `hop.ts` | HOP — move 2 tiles |
| `equip.ts` | EQUIP — pick up / equip item |
| `unequip.ts` | UNEQUIP — remove equipped item |
| `give.ts` | GIVE — give item to adjacent frog |
| `store.ts` | STORE_ITEM — place item inside container |
| `throw.ts` | THROW — throw item to ground (range 3) |
| `swing.ts` | SWING — multi-tile melee AoE via Generic Intent Builder |
| `pickup.ts` | PICKUP — pick up a GROUND item into inventory (Chebyshev 1 range) |
| `create_god.ts` | CREATE_GOD — god action: insert a new god row with name + 3 starting powers |
| `create_item.ts` | CREATE_ITEM — god action: create item in VOID state |
| `spawn_item.ts` | SPAWN_ITEM — god action: place item at world coords |
| `spawn.ts` | SPAWN_PREDATOR — god action: insert predator row |
| `kill_predator.ts` | KILL_PREDATOR — god action: hard-delete predator |
| `divine_heal_frog.ts` | DIV_HEAL_FROG — divine intervention: heal target frog +25 HP, deducts 25 favor |
| `divine_smite_enemy.ts` | DIV_SMITE_ENEMY — divine intervention: deal 50 damage to target predator, deducts 25 favor |
| `divine_spawn_item.ts` | DIV_SPAWN_ITEM — divine intervention: place existing item at target tile, deducts 25 favor |
| `divine_spawn_predator.ts` | DIV_SPAWN_PREDATOR — divine intervention: spawn new predator at target tile, deducts 25 favor |
| `god_pan.ts` | GOD_PAN — pure event: validates camera pan, no world mutation, no favor cost |
| `div_update_lair.ts` | DIV_UPDATE_LAIR — promotes staged tile data to committed lair layout; costs 5 favor/changed tile |
| `div_place_lair.ts` | DIV_PLACE_LAIR — anchors lair instance to overworld tile; free first time, 50 favor repeat |
| `open_door.ts` | OPEN_DOOR — frog traversal: enter lair from overworld D tile, or exit from lair D tile |
| `slither.ts` | SLITHER — predator: move head 1 tile, shift body segments |
| `strike.ts` | STRIKE — predator: 7 flat damage, chains to WRAP on kill |
| `wrap.ts` | WRAP — predator: canonical constriction set + escape roll |
| `ACTIONS.md` | Partial in-source registry (outdated — see `documentation/ACTIONS_DICTIONARY.md`) |

### `server/engine/`

The heartbeat and action resolution core.

| File | Purpose |
|------|---------|
| `heartbeat.ts` | `HeartbeatEngine` — 500ms sub-tick + 10s main tick event emitter |
| `tickProcessor.ts` | `processAllActions()` — inhale/exhale, 3-pass resolution (God→Predator→Frog) |
| `types.ts` | `SimulatedState` class + `UpdateInstruction` type |
| `movement.ts` | `validateAndQueueMovement()` — server-side pre-validation for STEP/HOP |
| `actionLog.ts` | `pushActionLog()` — ephemeral action log buffer, flushed as `SUBTICK_LOGS` |
| `xpDistributor.ts` | XP calculation and distribution helpers |
| `heartbeat.test.ts` | Heartbeat timer tests |
| `movement.test.ts` | Movement validation tests |

### `server/entities/`

AI predator brains. Each file calculates intents and queues `pending_actions` — no direct DB writes.

| File | Purpose |
|------|---------|
| `index.ts` | Entity registry — `processEntityIntents()`, routes by `enemyType` |
| `snake.ts` | Snake FSM — hunger check, frog detection, SLITHER/STRIKE intent calculation |

### `server/routers/`

| File | Purpose |
|------|---------|
| `routers.ts` | `appRouter` — assembles all sub-routers (system, admin, frog, god, party, worldLog) |
| `admin.ts` | All dev/testing endpoints — spawn chunks, list entities, grant XP, action queuing |

### `server/websockets/`

| File | Purpose |
|------|---------|
| `socket.ts` | WebSocket message handler — IDENTIFY, SUBMIT_ACTION, heartbeat listener wiring |
| `worldLogEmitter.ts` | Singleton event emitter for WORLD_LOG broadcast events |

### `server/worldgen/`

Modular procedural generation pipeline. All logic moved here from the old `server/utils/worldGenerator.ts`.

| File | Purpose |
|------|---------|
| `index.ts` | Public API — re-exports `generateChunk`, `MACRO_GRID`, `WORLD_SEED`, `POI_REGISTRY` etc. |
| `generator.ts` | `generateChunk(cx, cy, seed, macroGrid)` — orchestrates all 4 layers, returns `{grid, biome}` |
| `macroLayer.ts` | Wolfram ECA + radial mask; `buildMacroGrid()`, `isChunkSolid()`, pre-computed `MACRO_GRID` |
| `biomeMap.ts` | `BiomeDef`, `BIOME_REGISTRY`, `getBiomeForChunk()` — Perlin-based biome assignment per chunk |
| `tileResolver.ts` | `resolveTile()` — maps noise + biome thresholds → tile char; handles `%` lily pad scatter |
| `poiRegistry.ts` | `POI_REGISTRY` array of `PoiDef` objects; `stampPois(cx, cy, grid)` — bake-time tile overrides |
| `poiTypes.ts` | `PoiDef` interface and `PoiType` union type |

### `server/utils/`

| File | Purpose |
|------|---------|
| `worldGenerator.ts` | Backward-compat shim — re-exports `CHUNK_SIZE`, `WORLD_SEED`, and a 3-arg `generateChunk` wrapper |

### `server/assets/`

Static game asset definitions used at creation time.

| File | Purpose |
|------|---------|
| `frogModels.ts` | Frog visual model registry — `FrogColorPalette` type, `FROG_PALETTES` per species, base 16×16 pixel template, `generateFrogPixelData(species)` generator |

### `server/`

| File | Purpose |
|------|---------|
| `db.ts` | All database query functions — the only file that imports Drizzle/postgres; routers and action handlers import from here |
| `storage.ts` | S3 storage integration stub (see `THE_VOID_INVENTORY.md`) |

---

## `shared/`

Code imported by both `client/` and `server/`. Zero side effects, no DB, no imports from either side.

| File | Purpose |
|------|---------|
| `game.schema.ts` | All Zod schemas and inferred TypeScript types (Frog, Item, Chunk, ActionSchema, `CreateGodPayloadSchema`, etc.) |
| `divinePowers.ts` | Hardcoded list of selectable god powers (`DIVINE_POWER_LIST`) — source of truth for god creation UI and CREATE_GOD validation |
| `tileRegistry.ts` | `TILE_REGISTRY` — tile char → label, color, movementCost |
| `movement.ts` | Pure movement math — `movementBudget(dex)`, `chebyshevDistance()`, `calculateRemainingMove()` |
| `movement.test.ts` | Movement math unit tests |
| `const.ts` | Shared constants (CHUNK_SIZE, WORLD_SEED, etc.) |
| `types.ts` | Shared TypeScript utility types |
| `_core/errors.ts` | Shared error types |

---

## `drizzle/`

Database schema and migrations. Managed by Drizzle Kit (`yarn db:push`).

| File | Purpose |
|------|---------|
| `schema.ts` | Full Drizzle table definitions + enums (15 core tables — includes instances, lairEntrances) |
| `relations.ts` | Drizzle relation definitions |
| `0000_massive_the_anarchist.sql` | Initial migration — all base tables |
| `0001_add_pixel_data.sql` | Added pixel_data JSONB column to items |
| `0002_add_scale_indexes.sql` | Added 6 performance indexes (frogs grid/owner, items grid/owner_state, pending_actions actor_status, worldlog created_at) |
| `0003_gods_revamp.sql` | Gods schema revamp migration |
| `0004_instances_and_lairs.sql` | Added instances + lair_entrances tables; added instanceId FK to frogs, predators, items |
| `0005_drop_party_tables.sql` | Dropped partyId column from frogs |
| `0006_frog_model_json.sql` | Added model_json JSONB column to frogs (256-element per-species pixel art sprite) |
| `meta/_journal.json` | Migration history journal |
| `meta/0000_snapshot.json` | Schema snapshot for diffing |
| `drizzle.config.ts` | Drizzle Kit configuration |

---

## `scripts/`

Standalone scripts. **Not included in `tsconfig.json`** — run with `npx tsx scripts/<file>.ts`.

| File | Purpose |
|------|---------|
| `seedWorld.ts` | Full 315×315 chunk world seeder (−157..157, 99,225 chunks). Upserts in batches of 500. Supports `--dry-run`. |

---

## `documentation/`

| File | Purpose |
|------|---------|
| `FOLDER_MAP.md` | This file — project directory reference |
| `ACTION_PATH.md` | Full action lifecycle: UI button → pending_actions → heartbeat resolution → client |
| `ACTIONS_DICTIONARY.md` | Dev reference for every action handler (frog, predator, god) |
| `ENTITIES_DICTIONARY.md` | Dev reference for predator AI system and entity brains |
| `THE_VOID_INVENTORY.md` | Ghost code, enum stubs, architectural violations, unimplemented planned features |
| `SCALABILITY_ARCHITECTURE.md` | Bottleneck map by player count, index audit, scaling roadmap |

Root-level docs (kept separately):
- `DIVINE_ASCII_ARCHITECTURE.md` — Canvas rendering data path
- `PROCEDURAL_GENERATION.md` — World terrain generation
