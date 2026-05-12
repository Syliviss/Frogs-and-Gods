import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
export const storeHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog        = ctx.frog!;
    const itemId      = ctx.payload.itemId as string | undefined;
    const containerId = ctx.payload.containerId as string | undefined;
    if (!itemId || !containerId) {
      return { ok: false, message: "itemId and containerId required in payload." };
    }
    if (itemId === containerId) {
      return { ok: false, message: "An item cannot contain itself." };
    }

    const item = state.getItem(itemId);
    const container = state.getItem(containerId);

    if (!item)      return { ok: false, message: "Item not found." };
    if (!container) return { ok: false, message: "Container not found." };

    if (item.itemType === "CONTAINER") {
      return { ok: false, code: "FUMBLE", message: `${frog.name} fumbled trying to shove a bag into a bag!` };
    }

    if (container.itemType !== "CONTAINER") {
      return { ok: false, message: "Target item is not a container." };
    }
    const containerAccessible = (container.itemState === "EQUIPPED" || container.itemState === "INVENTORY") && container.ownerId === frog.id;
    if (!containerAccessible) {
      return { ok: false, message: "Container is not in your possession." };
    }

    const itemAccessible = (item.itemState === "EQUIPPED" || item.itemState === "INVENTORY") && item.ownerId === frog.id;
    if (!itemAccessible) {
      return { ok: false, message: "Item is not in your possession." };
    }

    const fumble = checkItemFumble(frog.id, "STORE_ITEM", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const itemId      = ctx.payload.itemId as string;
    const containerId = ctx.payload.containerId as string;

    const container = state.getItem(containerId);
    if (!container) return { success: false };

    const newInventory = [...(container.inventory ?? []), itemId];
    state.updateItem(containerId, { inventory: newInventory });
    out.push({ type: "ITEM_UPDATE", id: containerId, changes: { inventory: newInventory } });

    state.updateItem(itemId, {
      itemState:         "ITEM",
      parentContainerId: containerId,
      gridX:             null,
      gridY:             null,
    });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: {
      itemState: "ITEM", parentContainerId: containerId, gridX: null, gridY: null
    }});

    return { success: true, data: { itemId, containerId, itemName: state.getItem(itemId)?.name, containerName: container.name } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog        = ctx.frog!;
    const { itemId, containerId, itemName, containerName } = result.data as any;

    pushActionLog({
      text:     `${frog.name} stored ${itemName ?? "an item"} inside ${containerName ?? "a container"}`,
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
