import { pushActionLog } from "../engine/actionLog";
import { chebyshevDistance } from "../../shared/movement";
import { ActionSchemaSchema } from "../../shared/game.schema";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble, getEntitiesAt, applyDamage } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

interface DamageEntry {
  entityType: "frog" | "predator";
  id:         number;
  name:       string;
  damage:     number;
  newHp:      number;
  tileX:      number;
  tileY:      number;
}

export const swingHandler: ActionHandler = {
  // ─────────────────────────────────────────────
  // VALIDATE
  // Double-validates at execution time so a frog that moved during cast
  // doesn't silently attack out of range. Out-of-range at resolution =
  // silent reject (not FUMBLE) because the geometry changed, not the frog.
  // ─────────────────────────────────────────────
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog     = ctx.frog!;
    const itemId   = ctx.payload.itemId as string | undefined;
    const rawTiles = ctx.payload.targetTiles as { x: number; y: number }[] | undefined;

    if (!itemId) return { ok: false, message: "itemId required in payload." };
    if (!Array.isArray(rawTiles) || rawTiles.length === 0) {
      return { ok: false, message: "targetTiles required in payload." };
    }

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    if (item.itemState !== "EQUIPPED" || item.ownerId !== frog.id) {
      return { ok: false, message: "Item is not equipped by this frog." };
    }

    const schemaParse = ActionSchemaSchema.safeParse(item.statsJson.actionSchema);
    if (!schemaParse.success) {
      return { ok: false, message: "Item has no valid action schema." };
    }
    const schema = schemaParse.data;

    if (rawTiles.length !== schema.targeting.count) {
      return { ok: false, message: `Expected ${schema.targeting.count} target tile(s).` };
    }

    for (const tile of rawTiles) {
      const dist = chebyshevDistance(frog.gridX, frog.gridY, tile.x, tile.y);
      if (dist > schema.targeting.max_range) {
        return {
          ok:      false,
          message: `Tile (${tile.x},${tile.y}) is out of range.`,
        };
      }
    }

    const fumble = checkItemFumble(frog.id, schema.action_name, state);
    if (fumble) return fumble;

    return { ok: true };
  },

  // ─────────────────────────────────────────────
  // EXECUTE
  // Processes every target tile. A large entity occupying multiple tiles
  // takes damage once per tile hit (tracked via DamageEntry array without
  // deduplication — intentional multi-hit design).
  // ─────────────────────────────────────────────
  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog       = ctx.frog!;
    const rawTiles   = ctx.payload.targetTiles as { x: number; y: number }[];
    const damage     = (frog.statsJson.str ?? 0)
                     + (frog.statsJson.equippedStrBonus ?? 0)
                     + (frog.statsJson.equippedAttackBonus ?? 0);
    const damaged: DamageEntry[] = [];

    for (const tile of rawTiles) {
      const entities = getEntitiesAt(state, tile.x, tile.y);

      for (const victim of entities.frogs) {
        if (victim.id === frog.id) continue; // no self-hit
        const previousHp = victim.currentHp;
        applyDamage(state, out, "FROG", victim.id, damage);
        damaged.push({ entityType: "frog", id: victim.id, name: victim.name, damage, newHp: Math.max(0, previousHp - damage), tileX: tile.x, tileY: tile.y });
      }

      for (const pred of entities.predators) {
        const previousHp = pred.currentHp;
        applyDamage(state, out, "PREDATOR", pred.id, damage);
        damaged.push({ entityType: "predator", id: pred.id, name: pred.enemyType, damage, newHp: Math.max(0, previousHp - damage), tileX: tile.x, tileY: tile.y });
      }
    }

    return { success: true, data: { damaged, targetTiles: rawTiles } };
  },

  // ─────────────────────────────────────────────
  // BROADCAST
  // One action log entry per entity hit; notify the acting player.
  // ─────────────────────────────────────────────
  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog   = ctx.frog!;
    const data   = result.data as { damaged: DamageEntry[]; targetTiles: { x: number; y: number }[] };

    if (data.damaged.length === 0) {
      pushActionLog({
        text:     `${frog.name} swings — the air screams.`,
        x:        frog.gridX,
        y:        frog.gridY,
        chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }

    for (const hit of data.damaged) {
      pushActionLog({
        text:     `${frog.name} SWING hits ${hit.name} for ${hit.damage} dmg (HP: ${hit.newHp})`,
        x:        hit.tileX,
        y:        hit.tileY,
        chunk_id: `${Math.floor(hit.tileX / CHUNK_SIZE)}:${Math.floor(hit.tileY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }

    if (frog.ownerId != null) {
      notify(frog.ownerId, {
        type:        "SWING_RESOLVED",
        targetTiles: data.targetTiles,
        damaged:     data.damaged,
      });
    }
  },
};
