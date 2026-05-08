import { getItemById, getEquippedItemsByFrogId, updateItem } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const storeHandler: ActionHandler = {
  // @param ctx.payload.itemId      - UUID of the item to store inside a container
  // @param ctx.payload.containerId - UUID of the target container item
  // @returns FUMBLE if container-in-container attempted, or item-based block
  async validate(ctx: ActionContext): Promise<ValidationResult> {
    const frog        = ctx.frog!;
    const itemId      = ctx.payload.itemId as string | undefined;
    const containerId = ctx.payload.containerId as string | undefined;
    if (!itemId || !containerId) {
      return { ok: false, message: "itemId and containerId required in payload." };
    }
    if (itemId === containerId) {
      return { ok: false, message: "An item cannot contain itself." };
    }

    const [item, container] = await Promise.all([getItemById(itemId), getItemById(containerId)]);

    if (!item)      return { ok: false, message: "Item not found." };
    if (!container) return { ok: false, message: "Container not found." };

    // Container-in-container → always Fumble
    if (item.itemType === "CONTAINER") {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name} fumbled trying to shove a bag into a bag!`,
      };
    }

    // Container must be a CONTAINER type owned by the frog (EQUIPPED or INVENTORY)
    if (container.itemType !== "CONTAINER") {
      return { ok: false, message: "Target item is not a container." };
    }
    const containerAccessible =
      (container.itemState === "EQUIPPED" || container.itemState === "INVENTORY") &&
      container.ownerId === frog.id;
    if (!containerAccessible) {
      return { ok: false, message: "Container is not in your possession." };
    }

    // Item being stored must be owned by the frog (EQUIPPED or INVENTORY)
    const itemAccessible =
      (item.itemState === "EQUIPPED" || item.itemState === "INVENTORY") &&
      item.ownerId === frog.id;
    if (!itemAccessible) {
      return { ok: false, message: "Item is not in your possession." };
    }

    // Item-based fumble check
    const equipped = await getEquippedItemsByFrogId(frog.id);
    const fumble   = await checkItemFumble(frog.id, "STORE_ITEM", equipped);
    if (fumble) return fumble;

    return { ok: true };
  },

  async execute(ctx: ActionContext): Promise<ExecuteResult> {
    const itemId      = ctx.payload.itemId as string;
    const containerId = ctx.payload.containerId as string;

    const container = await getItemById(containerId);
    if (!container) return { success: false };

    // Add itemId to container's inventory array
    const newInventory = [...(container.inventory ?? []), itemId];
    await updateItem(containerId, { inventory: newInventory });

    // Set item state to ITEM (nested inside a container)
    await updateItem(itemId, {
      itemState:         "ITEM",
      parentContainerId: containerId,
      gridX:             null,
      gridY:             null,
    });

    return { success: true, data: { itemId, containerId } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog        = ctx.frog!;
    const itemId      = ctx.payload.itemId as string;
    const containerId = ctx.payload.containerId as string;
    const [item, container] = await Promise.all([getItemById(itemId), getItemById(containerId)]);

    pushActionLog({
      text:     `${frog.name} stored ${item?.name ?? "an item"} inside ${container?.name ?? "a container"}`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_STORED", itemId, containerId });
    }
  },
};
