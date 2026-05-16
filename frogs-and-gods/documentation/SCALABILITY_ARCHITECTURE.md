# Scalability Architecture

A record of the architecture decisions, known bottlenecks, and the roadmap for scaling Frogs & Gods to hundreds and eventually thousands of concurrent players.

---

## What the Architecture Gets Right

The foundation is defensible at scale. These design choices don't need to change:

- **Event-sourced action queue** — players submit intent to `pending_actions`; the engine resolves on a fixed schedule. This eliminates race conditions by design and decouples input rate from resolution rate.
- **"Great Inhale / Great Exhale" batch pattern** — the tick processor loads only the spatially relevant slice of the world into a `SimulatedState` (in-memory Maps), executes all actions against that snapshot, then commits all mutations in a single atomic DB transaction. One transaction per subtick, not one per action. The Inhale uses **per-actor neighborhoods** — each actor loads a small box around itself and its action targets — so query cost scales with actor count, not actor spread.
- **Deterministic world generation** — Wolfram CA + Perlin noise seeded at 42 means chunks never need to live in memory; they can always be regenerated or lazy-loaded.
- **Chunked spatial model** — vision queries load only a 3×3 chunk neighborhood (48×48 tiles) per client. The full 5040×5040 world is never loaded at once.
- **Pending actions indexed at the hot path** — `(resolveBucket, status)` index covers `getPendingActionsToResolve()`, the main tick loop query.

---

## Bottleneck Map by Player Count

| Threshold | Bottleneck | Root Cause |
|-----------|-----------|------------|
| ~50–200 players | DB query thrash | Missing indexes on spatial and ownership columns — every action submission and every tick does full table scans |
| ~500 players | Broadcast cost | `broadcast()` iterates the entire client Set and calls `ws.send()` per client per event; no viewport culling |
| ~1,000 players | Tick duration > 500ms | Per-actor neighborhood queries (implemented) prevent spatial blow-up; re-entry guard (implemented) prevents overlapping ticks. Remaining concern: very high predator-action counts — each predator with a pending action issues its own neighborhood query set |
| Multi-server | In-memory singletons break | `clients` Set, `heartbeat` instance, and `pendingIntents` buffer are all process-local; horizontal scaling is impossible without a coordination layer |

---

## Indexes Added (Migration 0002)

Six indexes were added to cover the five hot query paths. Applied May 2026.

| Index | Table | Covers |
|-------|-------|--------|
| `idx_frogs_owner` | `frogs(ownerId)` | `getFrogByOwnerId()` — called on every `SUBMIT_ACTION` WS message |
| `idx_frogs_grid` | `frogs(grid_x, grid_y)` | `getFrogsInBounds()` — called every 500ms in the Great Inhale |
| `idx_items_owner_state` | `items(owner_id, item_state)` | `getEquippedItemsByFrogId()`, `getInventoryItemsByFrogId()` — called by EQUIP/PICKUP/STORE handlers |
| `idx_items_grid` | `items(grid_x, grid_y)` | `getItemsInBounds()`, `getGroundItemsNear()` — called every 500ms in the Great Inhale |
| `idx_pending_actor_status` | `pending_actions(actor_id, status)` | `hasPendingActionForFrog()` — dedup gate called before every action is queued |
| `idx_worldlog_created_at` | `world_log_events(createdAt)` | `getRecentWorldLog()` — append-only table that grows unbounded; query tails by date |

**Before these indexes:** estimated ~135M row reads/second at 1,000 concurrent players (70× over PostgreSQL's capacity on a modest server).  
**After these indexes:** estimated ~2–3M row reads/second — within normal operating range.

---

## How the Indexes Map to the Action Pipeline

```
Player keypress
    │
    ▼
SUBMIT_ACTION (WebSocket)
    ├── hasPendingActionForFrog(actorId)          ← idx_pending_actor_status
    └── getFrogByOwnerId(userId)                  ← idx_frogs_owner
    │
    ▼
pendingIntents buffer (100ms flush → pending_actions table)
    │
    ▼  [every 500ms]
processAllActions() — the Great Inhale
    ├── getPendingActionsToResolve()              ← resolve_status_idx (pre-existing)
    └── per-actor neighborhood (one small box per frog/predator/god-action target):
        ├── getFrogsInBounds(box)                 ← idx_frogs_grid
        ├── getItemsInBounds(box)                 ← idx_items_grid
        ├── getPredatorsInChunkArea(box)          ← chunk_predator_idx
        └── getChunksInBoundingBox(box)           (all run in Promise.all per actor)
    │
    ▼
Action handlers (EQUIP, PICKUP, STORE, etc.)
    └── getEquippedItemsByFrogId(frogId)          ← idx_items_owner_state
    │
    ▼
Great Exhale — single DB transaction, all mutations committed atomically
    │                                             (indexes do not affect write speed)
    ▼
broadcast() → all connected WebSocket clients
```

---

## Remaining Scalability Work (Priority Order)

### ~~Priority 1 — Per-Actor Neighborhood Inhale~~ ✅ Implemented
**File:** `server/engine/tickProcessor.ts` (lines 44–130)

Previously the Inhale built one global bounding box across all actors and action targets. With two players at tile (0,0) and (4000,4000), the box covered ~16M tiles and pulled back everything in between.

**Fix:** Each actor now computes its own small neighborhood: `actor.position + all action targets ± 5 tile pad`. All neighborhoods are dispatched in `Promise.all`, and results are merged into `SimulatedState` (which uses `Map<id, entity>`, so overlapping neighborhoods for nearby actors are harmless). Query cost is now proportional to the number of actors with pending actions, not their spatial spread.

God actions that operate purely by entity ID (no `targetGridX/Y`) skip the spatial preload entirely — their targets are already loaded by the ID-based preloads that follow.

---

### ~~Priority 2 — Viewport-Culled Broadcasts~~ ✅ Implemented
**Files:** `server/websockets/socket.ts`, `client/src/hooks/useWorldLog.ts`, `client/src/hooks/useActionLogs.ts`

**Server side:**
- `GameClient` extended with `viewportChunkX?` / `viewportChunkY?`
- `broadcastToChunkArea(cx, cy, data)` — sends only to clients whose 3×3 viewport (center ± 1 chunk) overlaps the event chunk. Spectators with no viewport receive all events (admin observers); frogs/gods with no viewport receive nothing until they report position.
- `WORLD_LOG` events with `chunkX/chunkY` are routed through `broadcastToChunkArea`. Events without coords fall back to global `broadcast()` (currently only `SMITE_ENEMY` — no target position in payload yet).
- `SUBTICK_LOGS` are filtered per-client: each client receives only the log entries whose `chunk_id` overlaps their viewport.
- `HEAL_FROG` handler now looks up the target frog's `gridX/gridY` to derive chunk coords before emitting.
- New `VIEWPORT_UPDATE` message type registered: `{ type: "VIEWPORT_UPDATE", chunkX, chunkY }`.

**Client side:**
- `useWorldLog` accepts optional `viewportChunk` prop; sends `VIEWPORT_UPDATE` on connect and on chunk change.
- `useActionLogs` derives chunk from `frogX/frogY`; sends `VIEWPORT_UPDATE` on connect and whenever the frog crosses a chunk boundary (not on every tile move).

### ~~Priority 3 — Tick Re-Entry Guard~~ ✅ Implemented
**File:** `server/websockets/socket.ts`

Two flags guard the tick and broadcast sequences:

- `tickInFlight` — if a subtick fires while `processAllActions` is still running, it is skipped entirely. The next 500ms interval will try again.
- `broadcastPending` — if the 10s `broadcast` event arrives while a tick is still in flight, it is deferred and fires automatically in the `.finally()` once the tick commits.

`ENGINE_QUIVER` was also moved from before the tick (fire-and-forget) to inside the `.then()` (fires after the Great Exhale commits), so clients receive the pulse only after state is consistent.

The heartbeat timer model (`heartbeat.ts`) and tick processor (`tickProcessor.ts`) are unchanged.

### Priority 4 — Distributed Coordination (thousands of players / multi-server)
**Files:** `server/engine/heartbeat.ts`, `server/websockets/socket.ts`

Three process-local singletons prevent horizontal scaling:
- `const clients = new Set<GameClient>()` — WebSocket sessions are per-process
- `export const heartbeat = new HeartbeatEngine()` — each process runs its own independent tick loop
- `let pendingIntents: InsertPendingAction[]` — 100ms action buffer is per-process

Fix: extract the heartbeat coordinator to a dedicated process or Redis pub/sub; move the session registry to a Redis store; add idempotency keys to action queue entries. Estimated effort: 1–2 weeks. Not needed until a single well-resourced server is saturated.

**Pre-requisite before horizontal scaling: add PgBouncer (connection pooler)**

Each Node.js process holds its own postgres-js connection pool (`max: 20`). With N processes, PostgreSQL sees N × 20 = up to N×20 open connections. PostgreSQL's default `max_connections` is 100 — 5 processes would saturate it. Before running multiple server instances, deploy PgBouncer (or equivalent: RDS Proxy, pgpool) in front of PostgreSQL. PgBouncer holds a fixed pool of connections to the DB and multiplexes thousands of app-side connections onto that pool with near-zero overhead. The app-side pool config (`max: 20` in `server/db.ts`) stays unchanged — PgBouncer is an infrastructure layer, not an application change.

---

## Verification

To confirm indexes are active and being used:

```sql
-- Check indexes exist
SELECT tablename, indexname FROM pg_indexes
WHERE indexname LIKE 'idx_%'
ORDER BY tablename;

-- Confirm a spatial query uses the index (run with real data present)
EXPLAIN ANALYZE
SELECT * FROM frogs WHERE grid_x BETWEEN 0 AND 48 AND grid_y BETWEEN 0 AND 48;
-- Should show: "Index Scan using idx_frogs_grid"

EXPLAIN ANALYZE
SELECT * FROM items WHERE owner_id = 1 AND item_state = 'EQUIPPED';
-- Should show: "Index Scan using idx_items_owner_state"
```
