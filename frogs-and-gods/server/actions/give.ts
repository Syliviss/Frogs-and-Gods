import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { GiveActionSchema } from "../../shared/game.schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const giveHandler: ActionHandler = {
  // @param ctx.frogId - the receiving frog (actor = receiver)
  // @param ctx.payload.itemId - UUID of the item to give (must be VOID or GROUND)
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog   = ctx.frog!;
    const parsed = GiveActionSchema.safeParse(ctx.payload);
    if (!parsed.success) return { ok: false, message: "itemId required in payload." };
    const { itemId } = parsed.data;

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    if (item.itemState !== "VOID" && item.itemState !== "GROUND") {
      return { ok: false, message: `Item cannot be given (state: ${item.itemState}).` };
    }

    const allFrogItems = Array.from(state.items.values()).filter(i => i.ownerId === frog.id);
    const invCount = allFrogItems.length;
    const invCap   = frog.statsJson.inventoryCapacity ?? 6;
    if (invCount >= invCap) {
      return { ok: false, code: "FUMBLE", message: `${frog.name}'s stomach is full (${invCount}/${invCap})!` };
    }

    const fumble = checkItemFumble(frog.id, "GIVE", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item = state.getItem(itemId)!;

    state.updateItem(itemId, {
      itemState:         "INVENTORY",
      ownerId:           frog.id,
      gridX:             null,
      gridY:             null,
      parentContainerId: null,
    });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: {
      itemState: "INVENTORY", ownerId: frog.id, gridX: null, gridY: null, parentContainerId: null
    }});

    return { success: true, data: { itemId, itemName: item.name } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog   = ctx.frog!;
    const { itemId, itemName } = result.data as any;

    pushActionLog({
      text:     `${frog.name} received ${itemName}`,
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
