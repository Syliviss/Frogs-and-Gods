# SWING Weapon — Item JSONB Schema Reference

> **Who this is for:** Anyone creating a weapon item (via God CREATE_ITEM action or directly in the
> DB) that grants the SWING action to a frog when equipped.
>
> **Key principle:** A weapon only grants SWING because its `statsJson` tells both the server how
> to validate the attack and the client how to enter targeting mode. Nothing else needs to be changed.

---

## 1. How SWING Works (Quick Summary)

1. Frog equips an item whose `statsJson.grantedActions` includes `"SWING"`.
2. The client reads `statsJson.actionSchema` and enters **targeting mode** — the frog's player
   clicks `N` tiles on the canvas (where `N = actionSchema.targeting.count`).
3. Once all tiles are selected, the client auto-submits a `SWING` action with:
   ```json
   { "itemId": "<uuid>", "targetTiles": [{ "x": 3, "y": 7 }, ...] }
   ```
4. The server resolves SWING: each target tile is checked for frogs and predators, and
   **`damage = frog.str + frog.equippedAttackBonus`** is applied to everything standing there.
5. A single entity on two target tiles takes damage **twice** (intentional multi-hit).

---

## 2. The Complete `statsJson` Shape

```jsonc
{
  // ── Passive stat bonuses (applied when equipped, summed across all equipped items) ──
  "attackBonus":  5,        // integer — added to frog.equippedAttackBonus
  "defenseBonus": 0,        // integer — added to frog.equippedDefenseBonus (currently unused in combat math)
  "hpBonus":      0,        // integer — added to frog.equippedHpBonus (currently unused in combat math)

  // ── Action grants (which action buttons appear in the UI when this item is equipped) ──
  "grantedActions": ["SWING"],   // Must match an ACTION_REGISTRY key exactly

  // ── Action blocks (other actions that fumble while this item is in the frog's possession) ──
  "blockedActions": [],          // e.g. ["STEP"] to slow down a heavy weapon carrier

  // ── Targeting schema (read by the client to build the targeting UI, validated by server) ──
  "actionSchema": {
    "action_name":  "SWING",     // MUST match the ACTION_REGISTRY key AND grantedActions entry
    "cast_time_ms": 0,           // milliseconds of delay before the action resolves (0 = immediate next sub-tick)
    "targeting": {
      "type":               "TILE_SELECT",  // only supported type currently
      "count":              1,              // how many tiles the player must click before auto-submit
      "adjacency_required": false,          // if true, each tile must be adjacent to frog (Chebyshev dist = 1)
      "max_range":          1               // max Chebyshev distance from frog to each selected tile
    }
  }
}
```

---

## 3. Field-by-Field Reference

### Passive Bonuses

| Field | Type | Notes |
|---|---|---|
| `attackBonus` | `integer` | Summed across all equipped items → `frog.equippedAttackBonus`. **This is the primary damage modifier for SWING** (`damage = str + equippedAttackBonus`). |
| `defenseBonus` | `integer` | Summed and stored on frog but not currently read by any attack handler. Reserved. |
| `hpBonus` | `integer` | Summed and stored on frog but not currently applied to `currentHp`. Reserved. |

### `grantedActions`

An array of `ACTION_REGISTRY` keys. When the item is EQUIPPED, these strings appear as action buttons in the frog UI. For a SWING weapon this must include `"SWING"`.

```jsonc
"grantedActions": ["SWING"]
```

### `blockedActions`

An array of `ACTION_REGISTRY` keys. While the item is anywhere in the frog's possession (INVENTORY or EQUIPPED), attempting the blocked action returns a FUMBLE instead of executing. Useful for heavy weapons that prevent quick movement.

```jsonc
"blockedActions": ["STEP", "HOP"]  // frog carrying a massive war-axe can't dodge
```

### `actionSchema`

This is the most critical field for SWING. It is validated server-side by Zod's `ActionSchemaSchema` during `swingHandler.validate()`. If it is absent or malformed, SWING will always fail with `"Item has no valid action schema."`.

| Sub-field | Type | Rules |
|---|---|---|
| `action_name` | `string` | **Must exactly match** the ACTION_REGISTRY key (`"SWING"`). The server uses this to look up the handler. |
| `cast_time_ms` | `integer ≥ 0` | Delay in ms. Server converts to sub-ticks: `ceil(cast_time_ms / 500)`. `0` = resolves on the very next sub-tick after submission. |
| `targeting.type` | `"TILE_SELECT"` | Only supported value currently. |
| `targeting.count` | `integer ≥ 1` | Number of tiles the player must click. The client auto-submits once this many tiles are selected. The server rejects if the submitted `targetTiles` array length ≠ `count`. |
| `targeting.adjacency_required` | `boolean` | If `true`, each tile must be at Chebyshev distance ≤ 1 from the frog. The **server does not currently enforce this** — only `max_range` is checked server-side. The client uses it for UI hints only. |
| `targeting.max_range` | `integer ≥ 0` | Max Chebyshev distance from the frog's position to each target tile. **Server enforces this in both validate and execute.** `1` = adjacent tiles only. `2` = two tiles out (diagonal included). |

---

## 4. Example Weapons

### Short Sword (single adjacent strike, +3 attack)
```json
{
  "attackBonus": 3,
  "defenseBonus": 0,
  "hpBonus": 0,
  "grantedActions": ["SWING"],
  "blockedActions": [],
  "actionSchema": {
    "action_name": "SWING",
    "cast_time_ms": 0,
    "targeting": {
      "type": "TILE_SELECT",
      "count": 1,
      "adjacency_required": true,
      "max_range": 1
    }
  }
}
```

### War Hammer (single strike, longer reach, slow carrier)
```json
{
  "attackBonus": 8,
  "defenseBonus": 0,
  "hpBonus": 0,
  "grantedActions": ["SWING"],
  "blockedActions": ["HOP"],
  "actionSchema": {
    "action_name": "SWING",
    "cast_time_ms": 1000,
    "targeting": {
      "type": "TILE_SELECT",
      "count": 1,
      "adjacency_required": false,
      "max_range": 2
    }
  }
}
```

### Whirlwind Scythe (3-tile AoE arc, no reach bonus)
```json
{
  "attackBonus": 4,
  "defenseBonus": 0,
  "hpBonus": 0,
  "grantedActions": ["SWING"],
  "blockedActions": [],
  "actionSchema": {
    "action_name": "SWING",
    "cast_time_ms": 500,
    "targeting": {
      "type": "TILE_SELECT",
      "count": 3,
      "adjacency_required": true,
      "max_range": 1
    }
  }
}
```
> The player clicks 3 separate adjacent tiles. Any entity on a clicked tile takes damage once.
> An entity standing in the arc of all 3 tiles takes damage 3× (intentional multi-hit).

---

## 5. Damage Formula

```
damage = frog.statsJson.str + frog.statsJson.equippedAttackBonus
```

- `frog.statsJson.str` — the frog's base strength stat (default: `10`)
- `frog.statsJson.equippedAttackBonus` — sum of `attackBonus` across all currently EQUIPPED items

`attackBonus` on the weapon itself is included in `equippedAttackBonus` only **after the frog equips it** — the equip handler recalculates and writes the sum back to `frog.statsJson`.

**There is no weapon-specific damage roll.** All SWING weapons deal the same `str + equippedAttackBonus` per tile hit. Differentiation comes from:
- `attackBonus` (flat damage buff)
- `targeting.count` (how many tiles = how many potential hits)
- `targeting.max_range` (reach)
- `cast_time_ms` (when in the sub-tick the action resolves — faster snakes may dodge a slow swing)

---

## 6. Validation Checklist (What the Server Checks)

When a SWING action resolves, the server runs two passes:

**`validate()` — at submission time:**
- [ ] `payload.itemId` is present
- [ ] `payload.targetTiles` is a non-empty array
- [ ] Item exists in `SimulatedState` (was inhaled this tick)
- [ ] Item `itemState === "EQUIPPED"` AND `ownerId === frog.id`
- [ ] `item.statsJson.actionSchema` passes `ActionSchemaSchema` Zod parse
- [ ] `targetTiles.length === schema.targeting.count`
- [ ] Every tile is within `schema.targeting.max_range` (Chebyshev) of the frog's position
- [ ] No `blockedActions` fumble (nothing in frog's inventory blocks `"SWING"`)

**`execute()` — at resolution time (after the resolveBucket fires):**
- Iterates every `targetTile`, calls `getEntitiesAt()`, applies `applyDamage()` to frogs and predators
- No second geometry check — if the frog moved between submit and resolve, the tiles are still hit (already committed)
- Self-hit is explicitly skipped (`victim.id === frog.id → continue`)

---

## 7. Key Files

| Purpose | File |
|---|---|
| SWING action handler | `server/actions/swing.ts` |
| `ActionSchemaSchema` Zod validator | `shared/game.schema.ts` |
| `ItemStats` / `CreateItemPayloadSchema` | `shared/game.schema.ts` |
| God `CREATE_ITEM` action | `server/actions/create_item.ts` |
| Equip handler (recalculates bonuses) | `server/actions/equip.ts` |
| Client targeting state machine | `client/src/hooks/useItemIntentBuilder.ts` |
