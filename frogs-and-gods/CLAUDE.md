# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The project uses **yarn** (v4, specified in `packageManager`). Always use `yarn` or `npx tsx` — do not use `pnpm exec` or `npm`.

```bash
yarn dev          # Start dev server (Express + Vite HMR on same port, tsx watch)
yarn build        # vite build (client) + esbuild bundle (server)
yarn check        # tsc --noEmit (covers client/src, shared, server — NOT scripts/)
yarn test         # vitest run (node env; covers server/**/*.test.ts + shared/**/*.test.ts)
yarn format       # prettier --write .
yarn db:push      # drizzle-kit generate + drizzle-kit migrate (requires DATABASE_URL)
```

Run a single test file:
```bash
npx vitest run server/engine/heartbeat.test.ts
npx vitest run shared/movement.test.ts
```

Run the world seeder (standalone script, not in tsconfig include):
```bash
npx tsx scripts/seedWorld.ts
```

## Architecture

### The Stack

Single Express server serves both the tRPC API and the Vite-built React client. In dev mode, Vite middleware is attached to the Express instance (`server/_core/index.ts`). A WebSocket server runs on the same HTTP server at `/ws`.

### Auth / Context

There is **no real authentication**. `protectedProcedure` and `adminProcedure` are identical to `publicProcedure` — they just cast `ctx.user` to `User` so router code compiles. The context always returns `user: null`. This is a dev test-bed; auth is a future concern.

### tRPC

- **Server:** `server/routers.ts` defines `appRouter` with sub-routers: `system`, `admin`, `frog`, `god`, `party`, `worldLog`
- **Admin sub-router:** `server/routers/admin.ts` — all dev/testing endpoints (spawn chunks, list entities, grant XP, etc.)
- **Client:** `client/src/lib/trpc.ts` — `createTRPCReact<AppRouter>()`. Provider wired in `client/src/main.tsx` with `httpBatchLink` to `/api/trpc` and `superjson` transformer.
- All DB query functions live in `server/db.ts` — the routers import from there, never query directly.

### Database

PostgreSQL via Drizzle ORM (postgres-js driver). Schema in `drizzle/schema.ts`. All CRUD lives in `server/db.ts`.

Key tables: `users`, `frogs`, `gods`, `parties`, `party_invites`, `items`, `pending_actions`, `world_log_events`, `world_map_chunks`, `world_map_overrides`, `predators`.

`frogs.gridX/gridY` = absolute world tile position. Chunk coords derived as `Math.floor(gridX / 16)`. Predators denormalize `chunkX/chunkY` for spatial queries; frogs and items do not.

Migrations are in `drizzle/000N_*.sql`. Run `yarn db:push` to generate and apply.

### The Heartbeat Engine

`server/engine/heartbeat.ts` — `HeartbeatEngine extends EventEmitter`. Single instance created in `server/_core/index.ts` and passed to the WebSocket server.

- **10-second main tick** → emits `"resolution"` (action processing) then `"broadcast"`
- **500ms sub-ticks** → 20 buckets (0–19), emits `"subtick"` each interval
- Actions enqueue into the current bucket via `heartbeat.enqueue()`. On main tick, all buckets drain and `processMovementActions()` runs.
- Register a tick processor: `heartbeat.setTickProcessor(fn)`

### WebSocket

`server/websockets/socket.ts`. Clients identify with `{ type: "IDENTIFY", role, userId, godId }`. Server broadcasts:
- `ENGINE_TICK` / `ENGINE_QUIVER` — heartbeat pulses
- `WORLD_LOG` — game events from `worldLogEmitter` singleton

Client hooks: `useWorldLog` and `useEngineLog` in `client/src/hooks/` — both open `/ws`, send IDENTIFY, filter message types.

### World Generation

`server/utils/worldGenerator.ts` — deterministic Perlin noise (`fastnoise-lite`, seed 42). `generateChunk(chunkX, chunkY, WORLD_SEED)` returns a `string[][]` of tile chars (`≈ + ~ @ #`). Same inputs always produce the same grid.

Tile definitions (label, color, movementCost) live in `shared/tileRegistry.ts`. `TILE_REGISTRY` is the single source of truth used by both the canvas renderer and the movement system.

### Isometric Renderer

`client/src/components/Viewport.tsx` — HTML5 Canvas. Renders a 3×3 chunk neighborhood (48×48 tiles) in a 2:1 isometric projection.

Forward transform (tile → screen):
```
screenX = floor((worldX - worldY) * 8) + 400
screenY = floor((worldX + worldY) * 4) + 150
```

Inverse (screen → tile, for click detection):
```
u = clickX - 400;  v = clickY - 150
worldX = round(u / 16 + v / 8)
worldY = round(v / 8 - u / 16)
// convert to absolute: gridX = worldX + centerChunkX * 16
```

`worldX/worldY` here are viewport-local (relative to center chunk origin). Convert to absolute grid: `gridX = worldX + centerChunkX * CHUNK_SIZE`.

### Movement System

`shared/movement.ts` — pure functions: `movementBudget(dex)`, `chebyshevDistance()`, `calculateRemainingMove()`.
`server/engine/movement.ts` — `validateAndQueueMovement()` — validates range + cost, writes a `pending_actions` row.
`server/engine/tickProcessor.ts` — `processMovementActions()` — re-validates and applies positions on heartbeat resolution. Double-validation pattern is intentional.

### Client Routing

wouter `<Switch>` in `client/src/App.tsx`:
- `/` → `Admin` (the dev console)
- `/game` → `GamePage` (placeholder; not yet player-facing)
- `/create-frog` → `FrogCreationForm`

The Admin panel (`client/src/pages/Admin.tsx`) is the primary dev UI. It has tabbed sections for Users, Frogs, Gods, World (isometric map), Items, World Log, and Engine pulse.

### Shared Code

`shared/` is imported by both server and client. Key files:
- `game.schema.ts` — all Zod schemas and inferred types (Frog inputs, chunk coords, player vision, etc.)
- `tileRegistry.ts` — tile definitions
- `movement.ts` — movement math (no DB, no side effects)

### Scripts

`scripts/` is **not** included in `tsconfig.json`. `pnpm check` / `yarn check` will not type-check files there. Run them directly with `npx tsx scripts/<file>.ts`. Currently: `scripts/seedWorld.ts` seeds a 9×9 chunk grid (−4..4 on each axis) idempotently.
