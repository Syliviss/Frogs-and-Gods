import {
  getItemById,
  getEquippedItemsByFrogId,
  getCountOfEquippedItems,
  getCountOfInventoryItems,
  updateItem,
  updateFrog,
} from "../db";
import { pushActionLog } from "../engine/actionLog";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const equipHandler: ActionHandler = {
  // @param ctx.payload.itemId - UUID of the item to equip
  // @returns FUMBLE if equip capacity exceeded, silent reject for other failures
  async validate(ctx: ActionContext): Promise<ValidationResult> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string | undefined;
    if (!itemId) return { ok: false, message: "itemId required in payload." };

    const item = await getItemById(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    // Item must be on the ground at the frog's tile, or already in the frog's inventory
    const onGround    = item.itemState === "GROUND" && item.gridX === frog.gridX && item.gridY === frog.gridY;
    const inInventory = item.itemState === "INVENTORY" && item.ownerId === frog.id;
    if (!onGround && !inInventory) {
      return { ok: false, message: "Item is not accessible." };
    }

    // Equip capacity check → Fumble
    const equippedCount = await getCountOfEquippedItems(frog.id);
    const equipCap      = frog.statsJson.equipCapacity ?? 3;
    if (equippedCount >= equipCap) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name} fumbled the equip — equip slots full (${equippedCount}/${equipCap})!`,
      };
    }

    // Inventory capacity check (total carrying) → Fumble when picking from ground
    if (onGround) {
      const invCount = await getCountOfInventoryItems(frog.id);
      const invCap   = frog.statsJson.inventoryCapacity ?? 6;
      if (invCount >= invCap) {
        return {
          ok:      false,
          code:    "FUMBLE",
          message: `${frog.name} fumbled — inventory full (${invCount}/${invCap})!`,
        };
      }
    }

    // Item-based fumble check
    const allOwned = await getEquippedItemsByFrogId(frog.id);
    const fumble   = await checkItemFumble(frog.id, "EQUIP", allOwned);
    if (fumble) return fumble;

    return { ok: true };
  },

  // @param ctx.payload.itemId - UUID of the item to equip
  async execute(ctx: ActionContext): Promise<ExecuteResult> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;

    // Set item to EQUIPPED state
    await updateItem(itemId, {
      itemState: "EQUIPPED",
      ownerId:   frog.id,
      gridX:     null,
      gridY:     null,
      parentContainerId: null,
    });

    // Recalculate equipped bonuses from all EQUIPPED items
    const allEquipped = await getEquippedItemsByFrogId(frog.id);
    let attackBonus   = 0;
    let defenseBonus  = 0;
    let hpBonus       = 0;
    for (const eq of allEquipped) {
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
      text:     `${frog.name} equipped ${item?.name ?? "an item"}`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_EQUIPPED", itemId, frogId: frog.id });
    }
  },
};
