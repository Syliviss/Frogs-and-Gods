# Divine ASCII: Technical Architecture of the Map Display System

## Overview

Frogs & Gods uses what you might call a **Web Stack as Game Engine** philosophy. There is no custom game server, no physics simulation, and no client-side authority over game state. Instead, a standard Node.js/PostgreSQL/React stack is repurposed as a real-time game loop.

The central rule that governs every design decision:

> **The PostgreSQL database is the absolute source of truth. The browser canvas is a dumb projector. It paints what the server tells it to paint and does nothing else.**

This document traces the full path of a single frame of game state — from the row in the database to the ASCII character on your screen.

---

## The Data Path

### 1. The Source of Truth: PostgreSQL

Every tile, frog, predator, and item in the world lives exclusively in PostgreSQL. The client holds no authoritative state.

The terrain of the world is stored in the `world_map_chunks` table:

```sql
world_map_chunks (
  chunk_x         INTEGER NOT NULL,
  chunk_y         INTEGER NOT NULL,
  chunk_size       INTEGER DEFAULT 16,
  biome            VARCHAR(32) DEFAULT 'grassland',
  terrain_data_json TEXT,   -- 16×16 tile grid stored as a JSON string
  is_active        BOOLEAN,
  ...
  UNIQUE (chunk_x, chunk_y)
)
```

`terrain_data_json` deserializes to `string[][]` — a 16×16 grid of single ASCII characters. Each character maps to a tile type via the shared `TILE_REGISTRY`:

| Char | Tile      | Color     | Move Cost |
|------|-----------|-----------|-----------|
| `≈`  | Deep Lake | `#1a5f8a` | 5         |
| `+`  | Shore     | `#2a7a5a` | 3         |
| `~`  | River     | `#1e8870` | 4         |
| `@`  | Lily Pad  | `#4a7a20` | 1         |
| `#`  | Land      | `#5f9a30` | 2         |

All entity positions (`frogs`, `predators`, `items`) are stored as absolute world-grid coordinates (`gridX`, `gridY`). There is no "client position" concept. A frog is where the database says it is.

Chunk terrain is generated deterministically by a Perlin noise function seeded with a fixed constant (`WORLD_SEED = 42`). The same `(chunkX, chunkY)` coordinates will always produce the same terrain. This means chunks can be generated on-demand and stored lazily — only chunks that players actually visit are persisted.

---

### 2. The Dual-Loop Heartbeat Engine

The server runs a single, shared `HeartbeatEngine` instance (`server/engine/heartbeat.ts`). It is a Node.js `EventEmitter` with two independent timers:

```
HeartbeatEngine
│
├── setInterval (500ms) ────► emit("subtick")
│                               └─► processAllActions()
│                               └─► broadcast ENGINE_QUIVER + SUBTICK_LOGS
│
└── setTimeout (10_000ms) ──► emit("broadcast")
                                └─► broadcast ENGINE_TICK
                                └─► restart both timers
```

**The 500ms sub-tick** is the action-resolution pulse. Every half-second, the engine drains the `pending_actions` table of any queued actions whose `resolve_bucket` has elapsed, executes them against the database (movement, combat, item use), and broadcasts a lightweight `SUBTICK_LOGS` message containing a human-readable log of what happened. This is what makes actions feel responsive — a submitted move is resolved within half a second, not at the end of a 10-second epoch.

**The 10-second macro tick** is the world-state broadcast signal. It fires once every 10 seconds and broadcasts a single `ENGINE_TICK` message to every connected client. This signal tells clients: *the authoritative world state has advanced; go fetch a fresh snapshot.*

The two loops are independent. Sub-ticks fire 20 times per macro tick interval, continuously draining the action queue. The macro tick is purely a synchronization beacon.

---

### 3. Skinny Packets: The WebSocket Signal Layer

The WebSocket connection between server and client is intentionally lean. It does **not** push chunk terrain data or full entity lists. Instead, it pushes minimal signals — timestamps and log strings.

The core heartbeat messages:

| Message Type    | When              | Payload                                    | Purpose                                    |
|-----------------|-------------------|--------------------------------------------|--------------------------------------------|
| `ENGINE_TICK`   | Every 10 seconds  | `{ type: "ENGINE_TICK", timestamp: number }` | Signal: refetch your vision snapshot       |
| `ENGINE_QUIVER` | Every 500ms       | `{ type: "ENGINE_QUIVER", timestamp: number }` | Heartbeat keepalive pulse                  |
| `SUBTICK_LOGS`  | Every 500ms (if any) | `{ type: "SUBTICK_LOGS", logs: ActionLogEntry[] }` | Human-readable action outcomes           |
| `WORLD_LOG`     | On events         | God/combat event payloads                  | Narrative event feed                       |

The `ENGINE_TICK` message is a **signal, not a payload**. It carries no chunk data, no entity positions — just a timestamp. Its sole job is to tell the client "something may have changed; go ask the server what the world looks like now."

This design keeps WebSocket bandwidth near-zero. Broadcasting 9 chunks of terrain (each a 16×16 grid of characters) to every connected client on every tick would be expensive and wasteful. Most clients view overlapping regions; most chunks don't change between ticks. The skinny-packet model means clients only pull the data they need, when they need it.

---

### 4. Client Reception: The tRPC Vision Query

On the client, the `useTickSync` hook listens to the WebSocket for `ENGINE_TICK`. When it arrives, the hook triggers a tRPC query refetch:

```
ENGINE_TICK received
    │
    ▼
frog.getPlayerVision(frogId)  ← tRPC query via HTTP
    │
    ▼
Server: getPlayerVision handler
    │
    ├── Derive center chunk: centerCX = Math.floor(frog.gridX / 16)
    │                        centerCY = Math.floor(frog.gridY / 16)
    │
    ├── Build 3×3 coordinate list (9 chunks)
    │
    └── Promise.all([
            getChunksByCoords(9 coords),          ← terrain grids
            getFrogsInBounds(minGX, maxGX, ...),  ← frog positions
            getPredatorsInChunkArea(coords),       ← enemy positions
            getItemsInBounds(minGX, maxGX, ...),  ← loot positions
        ])
    │
    ▼
Response:
{
  chunks:    Record<"cx:cy", string[][]>,  // e.g. "2:3" → 16×16 char grid
  frogs:     Frog[],                       // absolute gridX, gridY
  predators: Predator[],                   // absolute gridX, gridY
  items:     Item[]                        // absolute gridX, gridY
}
```

All four database queries run in parallel. The response is a complete, self-contained snapshot of everything visible to the player at this moment. The client replaces its prior state entirely — there is no merging, diffing, or reconciliation. The server's answer is the truth.

---

### 5. The Canvas: A Dumb Projector

The `Viewport` component (`client/src/components/Viewport.tsx`) is an 800×420 pixel HTML5 Canvas. It receives the vision query response as props and redraws itself.

It has no game state of its own. It performs no validation. It does not know what move ranges are legal, whether a frog has enough HP to act, or whether a tile is passable. It receives a data structure and paints it.

The render pipeline fires inside a React `useEffect` with this dependency array:

```typescript
}, [centerChunkX, centerChunkY, chunks, entities, selectedTile]);
```

This means the canvas redraws **exactly when the server's data changes** — not on a timer, not on user input (except tile selection), not speculatively. There is no render loop. The canvas is passive.

Each redraw:

1. **Clears** the canvas to black (`#000000`)
2. **Iterates all 9 chunks** in the 3×3 grid, and for each of the 16×16=256 tiles per chunk, draws the ASCII character using `ctx.fillText()` in `"bold 12px monospace"` with the color from `TILE_REGISTRY`
3. **Draws entities** as 9×9 pixel filled squares — green (`#00ff88`) for frogs, red (`#ff4444`) for predators
4. **Draws the selected tile** highlight as a yellow (`#facc15`) 18×14 pixel outline rectangle

No physics. No collision detection. No prediction. No interpolation (see [Burst Fluidity](#burst-fluidity-60-fps-interpolation-planned) below). The canvas is a projector and the server's data packet is the film.

---

## The 3×3 Chunk Viewport

### Chunk Coordinates vs. Grid Coordinates

The world uses two coordinate systems:

**Grid coordinates** (`gridX`, `gridY`) are absolute tile positions in the infinite world grid. A frog at `gridX=34, gridY=19` is at tile (34, 19) of the world.

**Chunk coordinates** (`chunkX`, `chunkY`) identify 16×16 blocks of tiles:

```
chunkX = Math.floor(gridX / 16)
chunkY = Math.floor(gridY / 16)
```

Tile (34, 19) lives in chunk (2, 1), at local offset (2, 3) within that chunk.

The viewport always renders a **3×3 neighborhood of chunks** centered on the chunk containing the player's frog. With 16 tiles per chunk side, this gives:

```
3 chunks × 16 tiles = 48 tiles visible per axis
Total visible area: 48 × 48 = 2,304 tiles
```

The server vision query always fetches exactly these 9 chunks and all entities within their bounds. The client renders all 9, even if some chunks haven't been generated yet — ungenerated chunks simply don't appear in the `chunks` record, and the canvas skips missing entries silently, leaving those tiles black.

### The Isometric Projection Formula

Tiles are rendered in a **2:1 isometric projection** — the classic diamond-grid layout where the world's X axis runs to the lower-right and the Y axis runs to the lower-left.

The `worldX` and `worldY` used in the projection are **viewport-local** — relative to the center chunk's origin, not absolute world coordinates. An entity at absolute `(gridX, gridY)` is converted to viewport-local:

```
worldX = gridX - (centerChunkX * 16)
worldY = gridY - (centerChunkY * 16)
```

**Forward transform** (viewport-local tile → canvas pixel):

```
screenX = floor((worldX - worldY) × 12) + 400
screenY = floor((worldX + worldY) × 6)  + 150
```

The multipliers derive from the tile dimensions: `TILE_W = 24`, `TILE_H = 12`, halved for isometric spacing (`TILE_W/2 = 12`, `TILE_H/2 = 6`). The offsets (`400`, `150`) center the projection within the 800×420 canvas.

**Inverse transform** (canvas pixel → viewport-local tile, used for click detection):

```
u = clickX - 400
v = clickY - 150

worldX = round(u / 24 + v / 12)
worldY = round(v / 12 - u / 24)

// Convert to absolute:
gridX = worldX + (centerChunkX × 16)
gridY = worldY + (centerChunkY × 16)
```

The selected tile (from click) is stored in React state and passed back to the `Viewport` as a prop, where it receives a yellow highlight rectangle. The canvas has no memory of it between renders — it's just another prop.

---

## Burst Fluidity: 60 FPS Interpolation *(Planned)*

**Current behavior:** Entity positions update in discrete jumps. When an `ENGINE_TICK` arrives, the client refetches, gets new `gridX`/`gridY` values for all entities, and the canvas immediately redraws them at their new positions. A frog that moved three tiles appears to teleport.

**Planned behavior:** To mask the discrete server ticks and create visually smooth motion, a `requestAnimationFrame`-driven render loop will replace the current `useEffect`-on-state-change approach. The loop will:

1. On each `ENGINE_TICK` response, record the entity's **previous position** and **new position** alongside a timestamp
2. On each animation frame (targeting 60 FPS), compute a `t` value: `t = (now - tickReceivedAt) / 10_000` (normalized over the 10-second tick interval)
3. Linearly interpolate each entity's screen position: `pos = lerp(prevScreenPos, nextScreenPos, t)`
4. Draw the entity at the interpolated position

This is **purely a visual technique**. The interpolated positions exist only on the client canvas. They are never sent to the server, never validated, and have no effect on game logic. The server's database remains the only record of where entities actually are. The canvas is still a dumb projector — it just projects at 60 FPS with smooth transitions between the snapshots it receives.

This approach is sometimes called "dead reckoning lite" or "cosmetic interpolation." It is explicitly **not** client-side prediction — the client makes no assumptions about where an entity *will* be, only about how to visually animate the journey between two server-confirmed positions.

---

## Why This Architecture?

**The database as source of truth** eliminates an entire class of game bugs. There is no possibility of client-server desync, no split-brain state where two clients disagree about a frog's position, and no cheating vector that works by manipulating client state — because the client state is never authoritative. Every entity position, every item, every tile is read from the database on every tick. A client that crashes and reconnects instantly sees the correct world state on its next vision query.

**The stateless canvas** means zero game logic lives in the browser. Validation, movement cost calculation, combat resolution — all of this runs server-side in TypeScript functions that are directly testable and independently verifiable. The canvas component has no test surface because there is nothing to test beyond "did it call `ctx.fillText` with the right arguments."

**Skinny packets** keep the WebSocket layer dumb and cheap. The WebSocket connection's only job is to deliver heartbeat timestamps and human-readable log strings. The actual world state travels over tRPC queries — standard HTTP requests with caching, retries, and all the tooling that comes with them. Scaling the real-time layer means scaling a simple timestamp broadcaster, not a stateful chunk-delivery system.

The tradeoff is latency. Because the client only learns about world-state changes when it receives an `ENGINE_TICK` and completes a full tRPC round-trip, there is up to 10 seconds of latency between a game event occurring in the database and the client seeing it. For a turn-based, asynchronous game like Frogs & Gods, this is an acceptable and intentional constraint.
