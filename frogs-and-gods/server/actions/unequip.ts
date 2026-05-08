import {
  getItemById,
  getEquippedItemsByFrogId,
  updateItem,
  updateFrog,
} from "../db";
import { pushActionLog } from "../engine/actionLog";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { EquipActionSchema } from "../../shared/game.schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const unequipHandler: ActionHandler = {
  // @param ctx.payload.itemId - UUID of the item to unequip (must be EQUIPPED by this frog)
  async validate(ctx: ActionContext): Promise<ValidationResult> {
    const frog   = ctx.frog!;
    const parsed = EquipActionSchema.safeParse(ctx.payload);
    if (!parsed.success) return { ok: false, message: "itemId required in payload." };
    const { itemId } = parsed.data;

    const item = await getItemById(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    if (item.itemState !== "EQUIPPED" || item.ownerId !== frog.id) {
      return { ok: false, message: "Item is not equipped by this frog." };
    }

    // Item-based fumble check
    const equippedItems = await getEquippedItemsByFrogId(frog.id);
    const fumble        = await checkItemFumble(frog.id, "UNEQUIP", equippedItems);
    if (fumble) return fumble;

    return { ok: true };
  },

  async execute(ctx: ActionContext): Promise<ExecuteResult> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;

    await updateItem(itemId, { itemState: "INVENTORY" });

    // Recalculate equipped bonuses from remaining EQUIPPED items
    const remaining  = await getEquippedItemsByFrogId(frog.id);
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

    return { success: true, data: { itemId } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item   = await getItemById(itemId);

    pushActionLog({
      text:     `${frog.name} unequipped ${item?.name ?? "an item"}`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_UNEQUIPPED", itemId, frogId: frog.id });
    }
  },
};
