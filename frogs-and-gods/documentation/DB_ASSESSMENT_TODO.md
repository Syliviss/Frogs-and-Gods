# Database Assessment & TODO

Based on the review of the Drizzle schema (`drizzle/schema.ts`) and the database interface (`server/db.ts`), here is an assessment of the current database structure and a list of actionable TODO items for future improvements.

## 💪 Strengths
- **Asymmetric Gameplay Separation:** The schema cleanly separates `frogs` (mortal grinders) from `gods` (divine watchers), and `worldLogEvents` provides a solid broadcast mechanism to feed data back to the gods.
- **Flexible `JSONB` Schemas:** Using `statsJson` for frogs, items, and predators is a smart choice for an RPG/MMO-lite game. It prevents the need for database migrations every time a new stat, mutation, or temporary status effect is added.
- **Tick-Based Action Resolution:** The `pendingActions` table with `resolveBucket` handles concurrency, latency, and turn-based mechanics (the "heartbeat queue") very well.
- **Rich Container & Item System:** The `items` table is very robust. Supporting 1-of-1 items with different states (`GROUND`, `INVENTORY`, `EQUIPPED`, `CONTAINER`), internal inventories, and server-driven `actionSchema` sets up a foundation for deep gameplay mechanics.

## ⚠️ Weaknesses & Areas for Improvement
- **Lack of Referential Integrity (Foreign Keys):** Columns like `ownerId`, `partyId`, and `authorGodId` are used, but they lack Drizzle's `.references()` constraint. This could lead to orphaned records.
- **Missing Spatial Indexes:** While `predators` and `worldMapOverrides` have indexes on `(chunkX, chunkY)`, the `frogs` and `items` tables lack spatial indexes. Queries like `getFrogsInBounds` and `getItemsInBounds` will degrade in performance as the world grows.
- **Missing `chunkX` / `chunkY` on Frogs:** `frogs` only store `gridX/Y`, while `predators` store both their absolute `gridX/Y` and their derived `chunkX/Y`. This makes chunk-based bounding box queries for players slower.
- **`pixelData` Bloat in Items Table:** Storing a 256-element JSON array of hex colors directly on the `items` table will bloat the table massively, slowing down queries that just need item states or positions.
- **Event Log Infinite Growth:** `worldLogEvents` has no partitioning or TTL (time-to-live). In a persistent game world, this table will grow extremely fast.

---

## 📝 TODO List

- [ ] **Enforce Referential Integrity:** Add `.references()` to all relational ID columns (e.g., `ownerId` -> `users.id`, `partyId` -> `parties.id`, `authorGodId` -> `gods.id`).
- [ ] **Optimize Spatial Queries for Frogs & Items:**
  - [ ] Add spatial indexes `(gridX, gridY)` or chunk-based indexes to `frogs` and `items` tables.
  - [ ] Add `chunkX` and `chunkY` columns to `frogs` to match the `predators` optimization.
- [ ] **Offload Pixel Data:** Refactor `pixelData` out of the main `items` table into a separate `item_sprites` table (or cache it client-side) to prevent memory bloat during queries.
- [ ] **Implement Event Log TTL/Partitioning:** Add a cron job or an automated purge mechanism for `worldLogEvents` to clear out events older than a certain threshold, or set up table partitioning.
- [ ] **Flesh out the Snake "Wrapping" Mechanic:** Fully implement the constriction combat logic utilizing the `wrapping` and `segments` data in `predators.statsJson`.
- [ ] **Complete Generic Intent Builder Integration:** Finalize the server-driven action flow utilizing the `actionSchema` property in `ItemStats` for items/weapons.
