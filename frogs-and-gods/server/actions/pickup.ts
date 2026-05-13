import { pushActionLog } from "../engine/actionLog";
import { chebyshevDistance } from "../../shared/movement";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const pickupHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog = ctx.frog!;
    const targetX = ctx.targetGridX;
    const targetY = ctx.targetGridY;

    if (targetX == null || targetY == null) {
      return { ok: false, message: "Target coordinates required." };
    }

    const dist = chebyshevDistance(frog.gridX, frog.gridY, targetX, targetY);
    if (dist > 1) {
      return { ok: false, code: "FUMBLE", message: `${frog.name} reaches but (${targetX}, ${targetY}) is too far away.` };
    }

    const groundItems = state.getItemsAt(targetX, targetY);
    if (groundItems.length === 0) {
      return { ok: false, code: "FUMBLE", message: `${frog.name} reaches down but finds nothing there.` };
    }

    const allFrogItems = Array.from(state.items.values()).filter(i => i.ownerId === frog.id);
    const invCap = frog.statsJson.inventoryCapacity ?? 6;
    if (allFrogItems.length >= invCap) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name}'s stomach is full (${allFrogItems.length}/${invCap})!`,
      };
    }

    const fumble = checkItemFumble(frog.id, "PICKUP", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const item = state.getItemsAt(ctx.targetGridX!, ctx.targetGridY!)[0]!;
    const itemId = item.itemId;

    state.updateItem(itemId, {
      itemState:         "INVENTORY",
      ownerId:           frog.id,
      gridX:             null,
      gridY:             null,
      parentContainerId: null,
    });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: {
      itemState: "INVENTORY", ownerId: frog.id, gridX: null, gridY: null, parentContainerId: null,
    }});

    return { success: true, data: { itemId, itemName: item.name } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog = ctx.frog!;
    const { itemId, itemName } = result.data as { itemId: string; itemName: string };

    pushActionLog({
      text:     `${frog.name} picked up ${itemName}`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ITEM_PICKED_UP", itemId, frogId: frog.id });
    }
  },
};
