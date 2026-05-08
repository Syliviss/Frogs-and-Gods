import {
  getItemById,
  getEquippedItemsByFrogId,
  getCountOfInventoryItems,
  updateItem,
} from "../db";
import { pushActionLog } from "../engine/actionLog";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { GiveActionSchema } from "../../shared/game.schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const giveHandler: ActionHandler = {
  // @param ctx.frogId - the receiving frog (actor = receiver)
  // @param ctx.payload.itemId - UUID of the item to give (must be VOID or GROUND)
  async validate(ctx: ActionContext): Promise<ValidationResult> {
    const frog   = ctx.frog!;
    const parsed = GiveActionSchema.safeParse(ctx.payload);
    if (!parsed.success) return { ok: false, message: "itemId required in payload." };
    const { itemId } = parsed.data;

    const item = await getItemById(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    if (item.itemState !== "VOID" && item.itemState !== "GROUND") {
      return { ok: false, message: `Item cannot be given (state: ${item.itemState}).` };
    }

    // Stomach check — FUMBLE if full
    const invCount = await getCountOfInventoryItems(frog.id);
    const invCap   = frog.statsJson.inventoryCapacity ?? 6;
    if (invCount >= invCap) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name}'s stomach is full (${invCount}/${invCap})!`,
      };
    }

    // Item-based fumble check
    const equippedItems = await getEquippedItemsByFrogId(frog.id);
    const fumble        = await checkItemFumble(frog.id, "GIVE", equippedItems);
    if (fumble) return fumble;

    return { ok: true };
  },

  async execute(ctx: ActionContext): Promise<ExecuteResult> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;

    await updateItem(itemId, {
      itemState:         "INVENTORY",
      ownerId:           frog.id,
      gridX:             null,
      gridY:             null,
      parentContainerId: null,
    });

    return { success: true, data: { itemId } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item   = await getItemById(itemId);

    pushActionLog({
      text:     `${frog.name} received ${item?.name ?? "an item"}`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "god",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_GIVEN", itemId, frogId: frog.id });
    }
  },
};
