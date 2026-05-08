import { getItemById, getEquippedItemsByFrogId, updateItem, updateFrog } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { chebyshevDistance } from "../../shared/movement";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

const THROW_BASE_RANGE = 3;

export const throwHandler: ActionHandler = {
  // @param ctx.payload.itemId      - UUID of the item to throw
  // @param ctx.targetGridX / targetGridY - landing tile (must be within range)
  async validate(ctx: ActionContext): Promise<ValidationResult> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string | undefined;
    if (!itemId) return { ok: false, message: "itemId required in payload." };
    if (ctx.targetGridX == null || ctx.targetGridY == null) {
      return { ok: false, message: "Target coordinates required." };
    }

    const item = await getItemById(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    // Item must be in the frog's EQUIPPED or INVENTORY
    const accessible =
      (item.itemState === "EQUIPPED" || item.itemState === "INVENTORY") &&
      item.ownerId === frog.id;
    if (!accessible) return { ok: false, message: "Item is not in your possession." };

    // Range check (Chebyshev, base 3 — future: +DEX modifier)
    const dist = chebyshevDistance(frog.gridX, frog.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist > THROW_BASE_RANGE) {
      return { ok: false, message: `Throw range is ${THROW_BASE_RANGE} tiles (attempted ${dist}).` };
    }

    // Item-based fumble check
    const equipped = await getEquippedItemsByFrogId(frog.id);
    const fumble   = await checkItemFumble(frog.id, "THROW", equipped);
    if (fumble) return fumble;

    return { ok: true };
  },

  async execute(ctx: ActionContext): Promise<ExecuteResult> {
    const frog     = ctx.frog!;
    const itemId   = ctx.payload.itemId as string;
    const wasEquipped = (await getItemById(itemId))?.itemState === "EQUIPPED";

    // Land item on the ground at target tile
    await updateItem(itemId, {
      itemState:         "GROUND",
      ownerId:           null,
      gridX:             ctx.targetGridX!,
      gridY:             ctx.targetGridY!,
      parentContainerId: null,
    });

    // If it was equipped, recalculate frog's equipped bonuses
    if (wasEquipped) {
      const remaining = await getEquippedItemsByFrogId(frog.id);
      let attackBonus  = 0;
      let defenseBonus = 0;
      let hpBonus      = 0;
      for (const eq of remaining) {
        attackBonus  += eq.statsJson.attackBonus  ?? 0;
        defenseBonus += eq.statsJson.defenseBonus ?? 0;
        hpBonus      += eq.statsJson.hpBonus      ?? 0;
      }
      await updateFrog(frog.id, {
        statsJson: {
          ...frog.statsJson,
          equippedAttackBonus:  attackBonus,
          equippedDefenseBonus: defenseBonus,
          equippedHpBonus:      hpBonus,
        },
      });
    }

    return { success: true, data: { itemId, targetGridX: ctx.targetGridX, targetGridY: ctx.targetGridY } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item   = await getItemById(itemId);
    const tx     = ctx.targetGridX!;
    const ty     = ctx.targetGridY!;

    pushActionLog({
      text:     `${frog.name} threw ${item?.name ?? "an item"} to (${tx}, ${ty})`,
      x:        tx,
      y:        ty,
      chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_THROWN", itemId, targetGridX: tx, targetGridY: ty });
    }
  },
};
