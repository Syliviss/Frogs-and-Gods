import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { EquipActionSchema } from "../../shared/game.schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble, recalcEquippedBonuses } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const unequipHandler: ActionHandler = {
  // @param ctx.payload.itemId - UUID of the item to unequip (must be EQUIPPED by this frog)
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog   = ctx.frog!;
    const parsed = EquipActionSchema.safeParse(ctx.payload);
    if (!parsed.success) return { ok: false, message: "itemId required in payload." };
    const { itemId } = parsed.data;

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    if (item.itemState !== "EQUIPPED" || item.ownerId !== frog.id) {
      return { ok: false, message: "Item is not equipped by this frog." };
    }

    const fumble = checkItemFumble(frog.id, "UNEQUIP", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item = state.getItem(itemId)!;

    state.updateItem(itemId, { itemState: "INVENTORY" });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: { itemState: "INVENTORY" } });

    const newStats = { ...frog.statsJson, ...recalcEquippedBonuses(frog.id, state) };
    state.updateFrog(frog.id, { statsJson: newStats });
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: { statsJson: newStats } });

    return { success: true, data: { itemId, itemName: item.name } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog   = ctx.frog!;
    const { itemId, itemName } = result.data as { itemId: string; itemName: string };

    pushActionLog({
      text:     `${frog.name} unequipped ${itemName}`,
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
