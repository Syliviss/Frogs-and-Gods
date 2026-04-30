# Server Architecture — Frogs & Gods

Generated after removing the turn-based combat engine in preparation for the 10-second tick loop.

---

## Directory Overview

```
server/
├── _core/          # Framework wiring and shared utilities
├── engine/         # Game logic (combat engine removed; tick loop goes here)
├── routers/        # tRPC sub-routers
├── websockets/     # Real-time event infrastructure
├── db.ts           # Database query layer (Drizzle ORM)
├── storage.ts      # File / asset storage abstraction
├── routers.ts      # Root tRPC router — composes all sub-routers
└── game.test.ts    # Vitest suite (schema validation tests)
```

---

## `_core/` — Framework Wiring

| File | Purpose |
|------|---------|
| `index.ts` | Express server entry point; mounts tRPC, WebSocket, and Vite middleware |
| `trpc.ts` | tRPC instance, context type, `publicProcedure` / `protectedProcedure` helpers |
| `context.ts` | Per-request context builder (resolves session cookie → `ctx.user`) |
| `cookies.ts` | Session cookie name and `SameSite` option helpers |
| `systemRouter.ts` | Health-check and internal system endpoints |
| `env.ts` | Typed `process.env` access via Zod |
| `llm.ts` | Anthropic SDK wrapper used for AI-generated game content |
| `imageGeneration.ts` | AI image generation calls |
| `voiceTranscription.ts` | Audio-to-text helper |
| `oauth.ts` | OAuth 2.0 flow (Google sign-in) |
| `sdk.ts` | Shared SDK/client initialisation |
| `map.ts` | World-map utilities |
| `notification.ts` | Push / in-app notification helpers |
| `storageProxy.ts` | Proxies asset requests to the storage backend |
| `dataApi.ts` | Thin wrapper around external data APIs |
| `vite.ts` | Dev-mode Vite middleware integration |
| `types/` | Ambient type declarations (`cookie.d.ts`, `manusTypes.ts`) |

---

## `engine/` — Game Logic

The turn-based `combatLoop.ts` and `xpDistributor.ts` have been removed.
This directory is the intended home for the new **tick engine** (`tickLoop.ts`) that will run on a 10-second server heartbeat and broadcast results via the WebSocket layer.

---

## `routers/` — tRPC Sub-Routers

### `routers/admin.ts`
Admin-only procedures (no auth guard — add one before production):

| Procedure | Type | Description |
|-----------|------|-------------|
| `listUsers` | query | All registered users |
| `setUserRole` | mutation | Promote/demote a user to frog / god / admin |
| `listFrogs` | query | All Frog characters with full stats |
| `createTestFrog` | mutation | Spawns a synthetic test Frog (creates a backing user) |
| `grantXp` | mutation | Adds XP to a Frog, resolves level-ups inline |
| `resurrectFrog` | mutation | Restores a dead Frog to full HP/MP |
| `listGods` | query | All God profiles |
| `setDivinePower` | mutation | Manually sets a God's divine-power pool |
| `listLoot` | query | Full loot table |
| `seedLoot` | mutation | Seeds the 12-tier loot catalogue (idempotent guard) |
| `grantLoot` | mutation | Grants a specific item to a Frog's inventory |

---

## `routers.ts` — Root Router

Composes the full `appRouter` from sub-routers and inline route groups:

| Namespace | Description |
|-----------|-------------|
| `system` | Internal health / system routes (`_core/systemRouter`) |
| `admin` | Admin sub-router above |
| `auth.me` | Returns current user + linked Frog/God |
| `auth.logout` | Clears the session cookie |
| `auth.registerFrog` | Creates a Frog character for the current user |
| `auth.registerGod` | Creates a God profile for the current user |
| `frog.myFrog` | Returns the caller's Frog |
| `frog.getFrogById` | Looks up any Frog by ID |
| `frog.getInventory` | Returns the caller's Frog's item inventory |
| `god.myGod` | Returns the caller's God profile |
| `god.intervene` | God spends divine power to heal a Frog or smite an enemy in an active encounter |
| `party.create` | Creates a new party, assigns the Frog as leader |
| `party.invite` | Sends a party invite to another Frog |
| `party.join` | Accepts a pending party invite |
| `party.myParty` | Returns the caller's current party and its members |
| `party.pendingInvites` | Lists outstanding invites for the caller's Frog |
| `worldLog.recent` | Returns the last N world-log events from the database |

> **Removed:** `combat.startEncounter`, `combat.submitMove`, `combat.getEncounter`, `combat.activeEncounters` — replaced by the upcoming tick loop.

---

## `websockets/` — Real-Time Infrastructure

| File | Purpose |
|------|---------|
| `socket.ts` | WebSocket server setup; authenticates connections and routes messages to clients |
| `worldLogEmitter.ts` | Node.js `EventEmitter` singleton (`getWorldLogEmitter()`); decouples tRPC mutations from WebSocket broadcasts. The tick loop will emit tick results here. |

---

## `db.ts` — Database Query Layer

Exports typed query functions over the Drizzle ORM schema. All SQL lives here; routers call these functions and never write raw queries. Key entity groups:

- **Users** — `listAllUsers`, `setUserRole`, `createUserWithOpenId`
- **Frogs** — `createFrog`, `getFrogById`, `getFrogByUserId`, `listAllFrogs`, `updateFrog`, `getFrogInventory`, `getFrogsByPartyId`
- **Gods** — `createGod`, `getGodByUserId`, `getGodById`, `listAllGods`, `updateGod`
- **Parties** — `createParty`, `createPartyInvite`, `acceptPartyInvite`, `getPendingInvitesForFrog`
- **Encounters** — `createEncounter`, `getEncounterById`, `getActiveEncounters`, `updateEncounter`
- **World Log** — `createWorldLogEvent`, `getRecentWorldLog`
- **Loot** — `listAllLoot`, `bulkInsertLoot`, `countLoot`, `grantLootToFrog`

---

## `storage.ts`

Asset storage abstraction (local disk in dev, object-store in production). Used by `_core/storageProxy.ts` and image-generation helpers.

---

## `game.test.ts`

Vitest suite validating the shared Zod schemas (`CombatMoveSchema`, `EnemySchema`, `GodInterventionSchema`, `PartyInviteSchema`). Run with:

```bash
yarn test
```

---

## Next Steps for Tick Loop

1. Create `server/engine/tickLoop.ts` — exports a `startTickLoop(intervalMs = 10_000)` function.
2. Call `startTickLoop()` from `_core/index.ts` after the DB is ready.
3. Inside each tick: query active encounters, resolve combat, update DB, emit results via `getWorldLogEmitter()`.
4. Broadcast tick payloads to connected clients through `websockets/socket.ts`.
