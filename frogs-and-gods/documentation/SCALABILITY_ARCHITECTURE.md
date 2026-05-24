# Frogs & Gods — Scalability Architecture

Code-verified May 2026. All claims below were derived from reading the implementation directly; documentation was treated as potentially stale and cross-checked against the source.

---

## The 6-Layer Batched Update Pipeline

Every state-changing action travels through exactly six layers before it is committed to PostgreSQL. Understanding where each layer lives, what it batches, and where it can break is the core of this document.

```
CLIENT (WebSocket)
  │  { type: "SUBMIT_ACTION", actionType, targetGridX?, payload? }
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 1 — WS INTAKE BUFFER          server/websockets/socket.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  pendingIntents.push({ actorId, actionType, resolveBucket, ... })
  setInterval(100ms): db.insert(pendingActions).values(batch)
  → Client receives ACTION_QUEUED immediately (before DB write)
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 2 — DB QUEUE                  drizzle/schema.ts → pending_actions
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Rows persist with status="pending"
  resolveBucket = Math.floor(Date.now() / 500)
  Index: resolve_status_idx on (resolveBucket, status)
  │
  ▼  [every 500ms — HeartbeatEngine emits "subtick"]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 3 — SUB-TICK GATE             server/websockets/socket.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  tickInFlight flag: if previous Exhale is still running → SKIP
  broadcastPending flag: defers ENGINE_TICK until Exhale commits
  → No parallel ticks; no double-resolution
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 4 — THE GREAT INHALE          server/engine/tickProcessor.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Per-actor neighborhood queries (all in Promise.all per actor):
    getFrogsInBounds(box)               ← idx_frogs_grid
    getItemsInBounds(box)               ← idx_items_grid
    getPredatorsInChunkArea(box)        ← chunk_predator_idx
    getChunksInBoundingBox(box)
  Extra sections for lairs, entrances, god payloads, CREATE_FROG
  → Results merged into SimulatedState (Maps keyed by entity ID)
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 5 — THE LIVING LEDGER         server/engine/tickProcessor.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sort order: god actions first → then by DEX/speed descending
  SEQUENTIAL for-loop — one action at a time, no concurrency:
    1. Gate: handledActorsThisTick dedup (frog only)
    2. Gate: entity alive check
    3. handler.validate(ctx, state)    ← reads SimulatedState only
    4. handler.execute(ctx, state, out) ← mutates state + out[]
    5. handler.broadcast(ctx, result, notify)
  out[] accumulates UpdateInstruction[] throughout the loop
  │
  ▼
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 6 — THE GREAT EXHALE          server/engine/tickProcessor.ts
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Compile phase: UpdateInstruction[] → typed Maps
    frogUpdates:        Map<id, Partial<Frog>>    (merge via spread)
    predatorUpdates:    Map<id, Partial<Predator>>
    itemUpdates:        Map<id, Partial<Item>>
    frogsToInsert / itemsToInsert / predatorsToInsert: []
    predatorsToDelete:  Set<id>
    resolvedActions:    Set<id>
    cancelledActions:   Set<id>
  Execute phase: single db.transaction()
    → One UPDATE per modified entity (deduped)
    → Bulk INSERT for new rows
    → inArray UPDATE for all resolved/cancelled action IDs
  After commit: SUBTICK_LOGS broadcast + ENGINE_QUIVER
  │
  ▼
CLIENTS receive:
  SUBTICK_LOGS  — spatially filtered (broadcastToChunkArea 3×3 overlap)
  USER notify   — targeted WS message (FUMBLE, ACTION_RESOLVED, etc.)
  ENGINE_TICK   — 10s cycle marker (triggers tRPC vision refetch)
```

---

## Timing Budget

| Step | Worst-case latency |
|------|--------------------|
| WS intake buffer flush | up to 100ms |
| Pending row sits until next subtick | up to 500ms |
| **Total before action resolves** | **up to 600ms** |
| ENGINE_TICK (client refetches vision) | every 10s |

A WS-submitted action submitted at the worst possible moment (just after a 100ms flush and just after a 500ms subtick) takes up to 600ms to resolve. tRPC-submitted actions (admin panel) go directly to `pending_actions` via `createPendingAction()` and skip the 100ms buffer, so their worst case is 500ms.

---

## Bottleneck Map by Player Count

| Threshold | Bottleneck | Layer | Root Cause |
|-----------|-----------|-------|------------|
| ~50–200 players | DB query thrash | Inhale (4) | Missing indexes on spatial/ownership columns — fixed by migration 0002 |
| ~500 players | Broadcast cost | Post-Exhale | `broadcast()` iterates entire client Set; partial mitigation via `broadcastToChunkArea` (spatial events only) |
| ~1,000 players | Tick duration > 500ms | Living Ledger (5) | Sequential loop is O(N_actions). Each predator with a pending action adds its own Inhale neighborhood batch. High predator density compounds this. |
| Tick overrun | Subtick skipped | Gate (3) | If Exhale takes >500ms, the next subtick fires and immediately sets `tickInFlight` returns false — the fire is skipped. Actions accumulate until the next 500ms window. |
| Multi-server | In-memory singletons break | All layers | `clients Set`, `heartbeat` instance, `pendingIntents` buffer are all process-local. No cross-process coordination exists. |

### The Sequential Living Ledger — The Hard Bottleneck

The Living Ledger cannot be parallelized within a single tick because later actions must see state mutations from earlier ones (e.g. a god creates an item; a frog equips it in the same tick). The sort order (god first, then DEX descending) is the only form of priority within the loop.

At high action volume the Living Ledger will eventually push Exhale past 500ms, causing subtick skipping. The Exhale's dedup-by-entity-ID merge prevents N×UPDATE thrash, but the loop itself is still bounded by O(N_actions).

**Mitigation path:** Shard actions by spatial region across parallel tick workers, each owning a non-overlapping tile range. Cross-region actions (GOD_PAN, DIV_HEAL, etc.) route to a dedicated coordinator. This requires a significant refactor of the Inhale/Ledger/Exhale pipeline.

---

## Index Audit (Migration 0002, Applied May 2026)

All indexes verified against `drizzle/schema.ts` and confirmed active.

| Index name | Table | Columns | Hot query path |
|------------|-------|---------|----------------|
| `resolve_status_idx` | `pending_actions` | `(resolveBucket, status)` | `getPendingActionsToResolve()` — main Inhale fetch, fires every 500ms |
| `status_resolved_at_idx` | `pending_actions` | `(status, resolvedAt)` | `purgeResolvedActions()` — TTL cleanup every 10s |
| `idx_pending_actor_status` | `pending_actions` | `(actorId, status)` | `hasPendingActionForFrog()` — Poise gate at tRPC submission |
| `idx_frogs_owner` | `frogs` | `(ownerId)` | `getFrogByOwnerId()` — every WS SUBMIT_ACTION |
| `idx_frogs_grid` | `frogs` | `(gridX, gridY)` | `getFrogsInBounds()` — every Inhale |
| `idx_frogs_instance` | `frogs` | `(instanceId)` | `getFrogsByInstanceId()` — lair Inhale section A |
| `chunk_predator_idx` | `predators` | `(chunkX, chunkY)` | `getPredatorsInChunkArea()` — every Inhale |
| `idx_predators_instance` | `predators` | `(instanceId)` | `getPredatorsByInstanceId()` — lair Inhale section A |
| `idx_items_owner_state` | `items` | `(ownerId, itemState)` | `getEquippedItemsByFrogId()`, `getInventoryItemsByFrogId()` |
| `idx_items_grid` | `items` | `(gridX, gridY)` | `getItemsInBounds()` — every Inhale |
| `idx_items_instance` | `items` | `(instanceId)` | `getItemsByInstanceId()` — lair Inhale section A |
| `idx_worldlog_created_at` | `world_log_events` | `(createdAt)` | `getRecentWorldLog()` — append-only tail query |

**Missing index — potential gap at scale:** `predators(gridX, gridY)`. Predators denormalize `chunkX/chunkY` and are queried via `chunk_predator_idx`, so there is currently no need for a grid-coordinate index. If spatial predator queries by absolute tile ever appear (e.g. `getPredatorsAtTile(gridX, gridY)`), add `idx_predators_grid`.

---

## How the Inhale Avoids Global Spatial Blow-Up

Previously the Inhale built one global bounding box across all actors and action targets. With two players at (0,0) and (4000,4000), the box covered ~16M tiles.

**Current implementation** (verified in `tickProcessor.ts`): Each actor computes its own small neighborhood — `actor.position + action targets ± 5 tile pad`. All neighborhoods are dispatched in a single `Promise.all`, and results are merged into `SimulatedState` via Maps (overlapping neighborhoods for nearby actors are harmless — same entity ID, same Map key). Query cost is proportional to the number of actors with pending actions, not their spatial spread.

God actions that operate purely by entity ID (no `targetGridX/Y`) skip the spatial preload and use ID-based queries instead.

---

## Viewport-Culled Broadcasts (Implemented)

The WebSocket layer applies two levels of spatial filtering:

**Server side:** `broadcastToChunkArea(cx, cy, data)` sends only to clients whose reported viewport center (±1 chunk) overlaps the event's origin chunk. Spectators without a reported viewport receive all events. Frogs/gods without a viewport receive nothing until they send `VIEWPORT_UPDATE`.

**Client side:** `useActionLogs` applies a secondary Chebyshev distance filter (≤ 24 tiles) before displaying entries from `SUBTICK_LOGS`. This handles cases where server-side chunk filtering is coarser than the player's actual view.

`ENGINE_TICK` and `ENGINE_QUIVER` are NOT spatially filtered — they broadcast to all connected clients. At 1,000+ clients these become notable overhead but carry only a timestamp, so per-message cost is negligible.

---

## Tick Re-Entry Guard (Implemented)

Two boolean flags in `server/websockets/socket.ts` guard sequencing:

```typescript
// subtick handler
heartbeat.on("subtick", () => {
  if (tickInFlight) return;                      // skip if previous still running
  tickInFlight = true;
  void processAllActions(emitToUser)
    .then(() => { /* flush SUBTICK_LOGS + ENGINE_QUIVER */ })
    .finally(() => {
      tickInFlight = false;
      if (broadcastPending) { broadcastPending = false; runEngineBroadcast(); }
    });
});

// broadcast handler (10s)
heartbeat.on("broadcast", () => {
  if (tickInFlight) { broadcastPending = true; return; }   // defer
  runEngineBroadcast();  // ENGINE_TICK + purge
});
```

`ENGINE_QUIVER` fires inside `.then()` — after the Exhale commits, not before. Clients never receive a quiver for a tick that hasn't committed.

---

## Priority 4 — Distributed Coordination (Thousands of Players / Multi-Server)

Three process-local singletons currently prevent horizontal scaling:

| Singleton | Location | Problem |
|-----------|---------|---------|
| `const clients = new Set<GameClient>()` | `socket.ts` | WS sessions are per-process |
| `export const heartbeat = new HeartbeatEngine()` | `heartbeat.ts` | Each process runs an independent tick loop |
| `let pendingIntents: InsertPendingAction[]` | `socket.ts` | 100ms action buffer is per-process |

**Fix path:** Extract the heartbeat coordinator to a dedicated process or Redis pub/sub. Move the session registry to Redis. Add idempotency keys to action queue entries. Estimated effort: 1–2 weeks. Not needed until a single well-resourced server is saturated.

**Pre-requisite: PgBouncer.** Each Node.js process holds a postgres-js pool (`max: 20`). N processes = N×20 open connections. PostgreSQL defaults to `max_connections = 100` — 5 processes would saturate it. Deploy PgBouncer (or RDS Proxy) before running multiple server instances.

---

## Verification Queries

```sql
-- Confirm all indexes exist
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Confirm the hot path uses the index
EXPLAIN ANALYZE
SELECT * FROM pending_actions
WHERE resolve_bucket <= 3800000 AND status = 'pending';
-- Expect: "Index Scan using resolve_status_idx"

EXPLAIN ANALYZE
SELECT * FROM frogs WHERE grid_x BETWEEN 0 AND 48 AND grid_y BETWEEN 0 AND 48;
-- Expect: "Index Scan using idx_frogs_grid"

EXPLAIN ANALYZE
SELECT * FROM items WHERE owner_id = 1 AND item_state = 'EQUIPPED';
-- Expect: "Index Scan using idx_items_owner_state"
```
