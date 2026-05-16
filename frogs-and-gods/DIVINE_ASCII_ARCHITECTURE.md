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

| Char | Tile      | Color     | Move Cost | Notes |
|------|-----------|-----------|-----------|-------|
| `≈`  | Deep Lake | `#1a5f8a` | 5         | |
| `+`  | Shore     | `#2a7a5a` | 3         | |
| `~`  | River     | `#1e8870` | 4         | |
| `@`  | Lily Pad  | `#4a7a20` | 1         | Legacy — kept for backward compat with pre-overhaul chunks |
| `#`  | Land      | `#5f9a30` | 2         | |
| `%`  | Lily Pad  | `#4a7a20` | 1         | Active — produced by new generator, appears in water ~2/chunk |

All entity positions (`frogs`, `predators`, `items`) are stored as absolute world-grid coordinates (`gridX`, `gridY`). There is no "client position" concept. A frog is where the database says it is.

Items additionally carry a `pixel_data` column — a 256-element JSONB array representing a 16×16 pixel art sprite:

```sql
items (
  item_id       VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  item_state    item_state   DEFAULT 'GROUND',   -- VOID|GROUND|INVENTORY|EQUIPPED|ITEM|GOD
  grid_x        INTEGER,
  grid_y        INTEGER,
  pixel_data    JSONB,  -- (string | null)[] length 256, one hex color per pixel row-major
  ...
)
```

Each element of `pixel_data` is a CSS hex color string (e.g. `"#ff0000"`) or `null` for a transparent pixel. The array is row-major: index `i` maps to `col = i % 16`, `row = Math.floor(i / 16)`. A null value or `"#00000000"` is treated as fully transparent. This column is nullable — items without pixel art are rendered using a fallback color.

Chunk terrain is generated deterministically by a Perlin noise function seeded with a fixed constant (`WORLD_SEED = 42`). The same `(chunkX, chunkY)` coordinates will always produce the same terrain. This means chunks can be generated on-demand and stored lazily — only chunks that players actually visit are persisted.

---

### 2. The Dual-Loop Heartbeat Engine

The server runs a single, shared `HeartbeatEngine` instance (`server/engine/heartbeat.ts`). It is a Node.js `EventEmitter` with two independent timers:

```
HeartbeatEngine
│
├── setInterval (500ms) ────► emit("subtick")
│                               │  [skipped if previous tick's Exhale is still running]
│                               └─► processAllActions()
│                                     └─► broadcast SUBTICK_LOGS + ENGINE_QUIVER (after Exhale)
│
└── setTimeout (10_000ms) ──► emit("broadcast")
                                │  [deferred until in-flight tick finishes, if any]
                                └─► broadcast ENGINE_TICK
                                └─► restart both timers
```

**The 500ms sub-tick** is the action-resolution pulse. Every half-second, the engine drains the `pending_actions` table of any queued actions whose `resolve_bucket` has elapsed, executes them against the database (movement, combat, item use), and broadcasts `SUBTICK_LOGS` and `ENGINE_QUIVER` after the Great Exhale transaction commits. If the previous subtick's Exhale is still running when the interval fires, that subtick is skipped — no parallel ticks, no double-resolution.

**The 10-second macro tick** is the world-state broadcast signal. It fires once every 10 seconds and broadcasts `ENGINE_TICK` to every connected client — but if a subtick is still in-flight when the 10s timer expires, the broadcast is held until the tick finishes. This ensures clients never receive ENGINE_TICK while state is mid-commit.

The timer model is independent — the heartbeat fires on fixed intervals regardless. The sequencing guard lives in `socket.ts` (`tickInFlight` / `broadcastPending` flags), not in the heartbeat itself.

---

### 3. Skinny Packets: The WebSocket Signal Layer

The WebSocket connection between server and client is intentionally lean. It does **not** push chunk terrain data or full entity lists. Instead, it pushes minimal signals — timestamps and log strings.

The core heartbeat messages:

| Message Type    | When              | Payload                                    | Purpose                                    |
|-----------------|-------------------|--------------------------------------------|--------------------------------------------|
| `ENGINE_TICK`   | Every 10 seconds  | `{ type: "ENGINE_TICK", timestamp: number }` | Signal: refetch your vision snapshot       |
| `ENGINE_QUIVER` | After each subtick Exhale | `{ type: "ENGINE_QUIVER", timestamp: number }` | "Tick committed" pulse — fires after Great Exhale, not before |
| `SUBTICK_LOGS`  | Every 500ms (if any) | `{ type: "SUBTICK_LOGS", logs: ActionLogEntry[] }` | Human-readable action outcomes           |
| `WORLD_LOG`     | On events (viewport-culled) | God/combat event payloads           | Narrative event feed — sent only to clients whose viewport overlaps the event's origin chunk |
| `VIEWPORT_UPDATE` | Client → Server | `{ type: "VIEWPORT_UPDATE", chunkX, chunkY }` | Client reports its chunk center; enables spatial broadcast filtering |

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
  frogs:     Frog[],                       // absolute gridX, gridY — modelJson STRIPPED
  predators: Predator[],                   // absolute gridX, gridY
  items:     Item[]                        // absolute gridX, gridY — pixelData STRIPPED
}
```

**Note:** Both `pixel_data` (items) and `model_json` (frogs) are explicitly stripped before the response is sent:

```typescript
// server/routers.ts — inside getPlayerVision
const groundItems = itemRows.map(({ pixelData: _px, ...rest }) => rest);
```

This keeps vision payloads lean. A 256-element color array per visible item would bloat every tick response. Instead, sprite data is fetched lazily on demand via a separate tRPC query (see §6 below).
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

Each redraw runs four sequential passes over the same canvas context:

**Pass 1 — Clear.** Fill the entire 800×420 canvas with black (`#000000`).

**Pass 2 — Terrain.** Iterate all 9 chunks in the 3×3 grid. For each of the 16×16 = 256 tiles per chunk, draw the ASCII character (`ctx.fillText()`, `"bold 12px monospace"`) at its isometric screen position using the color from `TILE_REGISTRY`. Chunks absent from the response are silently skipped — those tiles stay black.

**Pass 3 — Ground items.** Iterate the `groundItems` prop (GROUND-state items with non-null coordinates). For each item, project its world position to screen coords using the same isometric formula. Then:
- If `spriteManager.get(item.itemId)` returns a baked canvas — draw it scaled to 24×24 pixels via `ctx.drawImage()`.
- Otherwise — draw a **pink** (`#f472b6`) 9×9 filled square as a fallback. This covers items that have no pixel art and items whose sprite has not yet been lazy-loaded.

Ground items are drawn *before* entities so frogs always appear visually on top of loot.

**Pass 4 — Entities.** Draw frogs as 18×18 pixel sprites via `frogSpriteManager.get(frog.id)`, falling back to green (`#00ff88`) 9×9 `fillRect` squares when the sprite hasn't baked yet. Draw predators as red (`#ff4444`) ASCII `'S'` characters via `ctx.fillText("S", screenX, screenY)`. Frog sprites are lazily loaded from `frogs.model_json` (see §7 below); predators remain ASCII glyphs.

**Pass 5 — Selection highlight.** If a tile is selected, draw a yellow (`#facc15`) 18×14 outline rectangle over it.

No physics. No collision detection. No prediction. No interpolation (see [Burst Fluidity](#burst-fluidity-60-fps-interpolation-planned) below). The canvas is a projector and the server's data packet is the film.

---

### 6. Item Sprite Rendering: The Lazy-Load Pipeline

Item sprites are a 16×16 pixel art overlay drawn on top of the terrain in the isometric viewport. Their data originates in the database `pixel_data` column, travels to the client in a separate on-demand query, and is rasterized into an off-screen canvas that the main `Viewport` reads from during each redraw.

#### Step 1 — Database storage

`pixel_data` is a JSONB column on the `items` table. Its value is a 256-element array where each entry is either a CSS hex color string or `null`:

```
pixel_data[i] → col = i % 16,  row = floor(i / 16)
```

A fully transparent pixel is represented as `null` or `"#00000000"`. The column itself is nullable — items with no pixel art have `pixel_data = NULL`.

When a god creates an item via the Admin UI, they supply 256 newline-separated hex values in a textarea. The client splits on `\n`, trims whitespace, maps empty lines to `null`, and sends the resulting array as part of the `CREATE_ITEM` pending action payload.

#### Step 2 — Exclusion from the vision snapshot

The `getPlayerVision` tRPC handler deliberately omits `pixel_data` from its response:

```typescript
// server/routers.ts
const groundItems = itemRows.map(({ pixelData: _px, ...rest }) => rest);
return { chunks, frogs, predators, items: groundItems };
```

A single `pixel_data` array is up to ~6 KB of JSON. Broadcasting it for every visible item on every tick would bloat an otherwise lean payload. The vision snapshot carries enough to position and identify items — their sprites are fetched separately.

#### Step 3 — Lazy fetch via `frog.getItemPixelData`

When the client needs to render a sprite it doesn't yet have cached, it calls:

```typescript
frog.getItemPixelData({ itemIds: string[] })  // max 64 IDs per request
// Returns: { itemId: string, pixelData: (string | null)[] | null }[]
```

This query is driven by item IDs visible in the current vision snapshot. The client triggers it after receiving a fresh vision response and discovering item IDs not yet present in `SpriteManager`.

#### Step 4 — SpriteManager: the in-memory raster cache

`client/src/lib/SpriteManager.ts` is a singleton that holds a `Map<itemId, HTMLCanvasElement>`. It has three methods:

```typescript
spriteManager.bake(itemId, pixels)  // rasterizes once, stores canvas
spriteManager.get(itemId)           // returns canvas or undefined
spriteManager.prune(activeItemIds)  // evicts canvases for items no longer visible
```

`bake()` creates an off-screen 16×16 `<canvas>` element, iterates the 256-element pixel array, and fills each non-null, non-transparent pixel with `ctx.fillRect(col, row, 1, 1)`. It is idempotent — calling it again for the same `itemId` is a no-op. The baked canvas is never modified after creation.

`prune()` is called after each `ENGINE_TICK` vision refetch, passing the union of currently-visible ground item IDs and the player's held item IDs. Any canvas whose item ID is absent from that set is evicted from the Map, freeing the memory.

#### Step 5 — Viewport rendering (Pass 3)

During each `Viewport` redraw, Pass 3 iterates `groundItems` (items with non-null `gridX`/`gridY`). For each item the isometric screen position is computed and then:

```
spriteCanvas = spriteManager.get(item.itemId)

if spriteCanvas:
    ctx.drawImage(spriteCanvas, screenX - 12, screenY - 12, 24, 24)
    // scales the 16×16 off-screen canvas to 24×24 on the main canvas
    // imageSmoothingEnabled = false keeps pixels blocky (pixel-art quality)
else:
    ctx.fillStyle = "#f472b6"    // pink fallback
    ctx.fillRect(screenX - 4, screenY - 4, 9, 9)
```

The fallback pink square is the same visual weight as the green frog / red predator squares — all entities without sprite art render as 9×9 colored squares. This means items are always visible on the map even before their sprites have been fetched or if they were never given pixel art.

#### Full pipeline summary

```
DB: items.pixel_data (JSONB 256-element array)
    │
    │  [excluded from getPlayerVision response]
    │
    ▼
frog.getItemPixelData (on-demand tRPC query, triggered by vision refetch)
    │
    ▼
SpriteManager.bake(itemId, pixels)
    → off-screen 16×16 HTMLCanvasElement, stored in Map
    │
    ▼
Viewport Pass 3 — spriteManager.get(itemId)
    → drawImage (24×24, no smoothing)   if baked
    → fillRect  pink 9×9 square         if not baked / no pixel art
```

---

### 7. Frog Sprite Rendering: The Model Pipeline

Frog sprites follow the same lazy-load pipeline as item sprites, with one key difference: the pixel data is **generated server-side at frog creation** from a species palette and a shared template, rather than being authored by hand.

#### Step 1 — Database storage

`model_json` is a JSONB column on the `frogs` table — a 256-element `(string | null)[]` representing a 16×16 pixel art sprite. It is populated at creation time by `generateFrogPixelData(species)` in `server/assets/frogModels.ts`.

#### Step 2 — The model registry (`server/assets/frogModels.ts`)

The registry defines two things:

- **`FROG_PALETTES`** — a `Record<FrogSpecies, FrogColorPalette>` mapping each species to four color slots: `body`, `belly`, `eye`, `pupil`. **This is the only place you need to edit to change a species' appearance.**
- **`BASE_TEMPLATE`** — a 256-element `PixelKey[]` array defining the frog silhouette. Each entry maps a pixel to a palette slot (`"body"`, `"belly"`, `"eye"`, `"pupil"`, or `null` for transparent).

`generateFrogPixelData(species)` maps template keys through the species palette → output hex array. Template shape changes affect all species; palette changes affect only the target species.

#### Steps 3–5 — Exclusion, lazy fetch, bake, prune

Identical to the item sprite pipeline:

- `getPlayerVision` strips `model_json` from the frog rows it returns
- `frog.getFrogSpriteData({ frogIds })` fetches `{ id, modelJson }[]` on demand (max 64)
- A second `SpriteManager` instance (`frogSpriteManager` in `GamePage.tsx`) bakes and caches sprites keyed by `String(frog.id)` — separate from the item cache to prevent ID collisions
- `frogSpriteManager.prune(visibleFrogIds)` is called after each tick refetch

#### Viewport rendering

In Pass 3, for each frog entity: `frogSpriteManager.get(String(entity.id))` → `drawImage(18×18)` if baked, or green `#00ff88` 9×9 square fallback if not.

```
DB: frogs.model_json (JSONB 256-element array, generated from FROG_PALETTES at creation)
    │
    │  [excluded from getPlayerVision response]
    │
    ▼
frog.getFrogSpriteData (on-demand tRPC query, triggered by vision refetch)
    │
    ▼
frogSpriteManager.bake(String(frog.id), modelJson)
    → off-screen 16×16 HTMLCanvasElement, stored in Map
    │
    ▼
Viewport Pass 3 — frogSpriteManager.get(String(entity.id))
    → drawImage (18×18, no smoothing)    if baked
    → fillRect  green 9×9 square         if not baked / null modelJson
```

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

---

## Server-Driven Item Actions & The Generic Intent Builder

### The Core Constraint

No item-specific logic lives in the frontend. The browser canvas is a dumb projector and the ActionBar is a dumb renderer. When the game needs a new weapon, the admin creates an item in the database — the frontend adapts automatically.

### action_schema: The Contract

Items can embed a targeting specification inside their `stats_json` JSONB column:

```json
{
  "attackBonus": 5,
  "grantedActions": ["SWING"],
  "actionSchema": {
    "action_name": "SWING",
    "targeting": {
      "type": "TILE_SELECT",
      "count": 3,
      "adjacency_required": true,
      "max_range": 1
    },
    "cast_time_ms": 4000
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `action_name` | string | Must match an `ACTION_REGISTRY` key in `server/actions/index.ts` |
| `targeting.type` | `"TILE_SELECT"` | Only supported targeting mode (more planned) |
| `targeting.count` | number | How many tiles the player must click before the action auto-submits |
| `targeting.adjacency_required` | boolean | Intent flag; for `max_range: 1`, the per-tile Chebyshev check already enforces adjacency |
| `targeting.max_range` | number | Maximum Chebyshev distance from frog to each target tile |
| `cast_time_ms` | number | Milliseconds from submission to execution (0 = next sub-tick) |

No migration is required — `stats_json` is already a JSONB column with an open TypeScript index signature.

### Frontend Flow: The Generic Intent Builder

```
1. getEquippedActions() returns { actionName, itemId, actionSchema }[]
2. ActionBar renders button: SWING (4s)
3. Player clicks SWING → intentBuilder.startTargeting(itemId, schema) → TARGETING mode
4. onMouseMove → canvas Pass 5b: orange hover highlight
5. Player clicks tile → dist check → append to selectedTiles[] → Pass 5a: red overlay
6. When count tiles selected → submitItemActionForFrog.mutate() → "Locked In" spinner
7. Escape or right-click → cancel()
```

The `useItemIntentBuilder` hook (`client/src/hooks/useItemIntentBuilder.ts`) is a `useReducer` state machine: `"IDLE"` ↔ `"TARGETING"`.

### Backend Flow: Deferred Execution via resolveBucket

```
resolveBucket = floor(Date.now() / 500) + ceil(cast_time_ms / 500)
→ For 4000ms: +8 buckets = 4 seconds

Every 500ms: SELECT * FROM pending_actions WHERE resolve_bucket <= currentBucket
  → Sub-ticks 1–7: SWING row skipped (future bucket)
  → Sub-tick 8:    SWING row matched → runAction("SWING", ctx) fires
```

The timer is the database row itself. No `setTimeout` anywhere in the path.

### The Poise Mechanic

```typescript
// admin.submitItemActionForFrog — at submission, NOT inside runAction():
const inPoise = await hasPendingActionForFrog(frogId);
if (inPoise) throw new TRPCError({ code: "BAD_REQUEST", message: "Frog is in Poise." });
```

The gate is at the tRPC layer only. If it were inside `runAction()`, the SWING row would block its own resolution (the row is still status="pending" when the engine tries to execute it).

### Viewport Rendering Passes (Updated)

| Pass | Content | Style |
|------|---------|-------|
| 1 | Terrain tiles | ASCII char |
| 2 | Ground items | Sprite / pink fallback |
| 3 | Entities | Frogs: 18×18 sprite / green 9×9 fallback; Predators: red `'S'` ASCII glyph |
| 4 | Selected tile | Yellow stroke |
| 5a | Confirmed targeting tiles | Red semi-transparent fill |
| 5b | Hovered target tile | Orange semi-transparent fill |

---

## Map Studio (Developer Screenshot Tool)

`client/src/pages/MapStudio.tsx` is a dedicated developer page reachable at `/map-studio` (linked from the admin panel's "USER EXPERIENCE TESTING" dropdown). It renders an arbitrarily large version of the isometric ASCII map for content creation and screenshot work.

### Controls

| Control | Range | Effect |
|---------|-------|--------|
| Center X / Center Y | any valid chunk coord | Camera center (same as `getGodVision`) |
| Radius | 1–5 | Determines how many chunks surround the center: (2r+1)² total |
| Scale | 1×, 2×, 3× | Multiplies `TILE_W` (24→48→72) and `TILE_H` (12→24→36) |
| Entities toggle | on/off | Show/hide frogs and predators |
| Items toggle | on/off | Show/hide ground items |
| Save PNG | — | Downloads the full canvas as a PNG file |

### Canvas Sizing

```
D        = (2 × radius + 1) × 16   // tile diameter
TILE_W   = 24 × scale
TILE_H   = 12 × scale
CANVAS_W = D × TILE_W
CANVAS_H = D × TILE_H + TILE_H     // +1 row top margin
OFFSET_X = CANVAS_W / 2
OFFSET_Y = TILE_H
```

At radius 5 and scale 3 the canvas reaches ~12,672 × 6,336 px — intentionally large for high-resolution export.

### Server Query

`admin.getMapStudioChunks` (`GetMapStudioChunksSchema` — `centerChunkX`, `centerChunkY`, `radius`) fetches the full (2r+1)² chunk grid in one request, applies tile overrides, and returns `{ chunks, frogs, predators, items }`. It reuses the same DB helpers as `getGodVision`; the only difference is the variable-radius coords array.

---

## Why This Architecture?

**The database as source of truth** eliminates an entire class of game bugs. There is no possibility of client-server desync, no split-brain state where two clients disagree about a frog's position, and no cheating vector that works by manipulating client state — because the client state is never authoritative. Every entity position, every item, every tile is read from the database on every tick. A client that crashes and reconnects instantly sees the correct world state on its next vision query.

**The stateless canvas** means zero game logic lives in the browser. Validation, movement cost calculation, combat resolution — all of this runs server-side in TypeScript functions that are directly testable and independently verifiable. The canvas component has no test surface because there is nothing to test beyond "did it call `ctx.fillText` with the right arguments."

**Skinny packets** keep the WebSocket layer dumb and cheap. The WebSocket connection's only job is to deliver heartbeat timestamps and human-readable log strings. The actual world state travels over tRPC queries — standard HTTP requests with caching, retries, and all the tooling that comes with them. Scaling the real-time layer means scaling a simple timestamp broadcaster, not a stateful chunk-delivery system.

The tradeoff is latency. Because the client only learns about world-state changes when it receives an `ENGINE_TICK` and completes a full tRPC round-trip, there is up to 10 seconds of latency between a game event occurring in the database and the client seeing it. For a turn-based, asynchronous game like Frogs & Gods, this is an acceptable and intentional constraint.
