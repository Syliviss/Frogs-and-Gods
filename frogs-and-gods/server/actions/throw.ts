import { pushActionLog } from "../engine/actionLog";
import { chebyshevDistance } from "../../shared/movement";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

const THROW_BASE_RANGE = 3;

export const throwHandler: ActionHandler = {
  // @param ctx.payload.itemId      - UUID of the item to throw
  // @param ctx.targetGridX / targetGridY - landing tile (must be within range)
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string | undefined;
    if (!itemId) return { ok: false, message: "itemId required in payload." };
    if (ctx.targetGridX == null || ctx.targetGridY == null) {
      return { ok: false, message: "Target coordinates required." };
    }

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    const accessible =
      (item.itemState === "EQUIPPED" || item.itemState === "INVENTORY") &&
      item.ownerId === frog.id;
    if (!accessible) return { ok: false, message: "Item is not in your possession." };

    const dist = chebyshevDistance(frog.gridX, frog.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist > THROW_BASE_RANGE) {
      return { ok: false, message: `Throw range is ${THROW_BASE_RANGE} tiles.` };
    }

    const fumble = checkItemFumble(frog.id, "THROW", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog     = ctx.frog!;
    const itemId   = ctx.payload.itemId as string;
    const item = state.getItem(itemId)!;
    const wasEquipped = item.itemState === "EQUIPPED";

    state.updateItem(itemId, {
      itemState:         "GROUND",
      ownerId:           null,
      gridX:             ctx.targetGridX!,
      gridY:             ctx.targetGridY!,
      parentContainerId: null,
    });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: {
      itemState: "GROUND", ownerId: null, gridX: ctx.targetGridX!, gridY: ctx.targetGridY!, parentContainerId: null
    }});

    if (wasEquipped) {
      const remaining = Array.from(state.items.values()).filter(i => i.ownerId === frog.id && i.itemState === "EQUIPPED");
      let attackBonus  = 0;
      let defenseBonus = 0;
      let hpBonus      = 0;
      for (const eq of remaining) {
        attackBonus  += eq.statsJson.attackBonus  ?? 0;
        defenseBonus += eq.statsJson.defenseBonus ?? 0;
        hpBonus      += eq.statsJson.hpBonus      ?? 0;
      }
      const newStats = {
        ...frog.statsJson,
        equippedAttackBonus:  attackBonus,
        equippedDefenseBonus: defenseBonus,
        equippedHpBonus:      hpBonus,
      };
      state.updateFrog(frog.id, { statsJson: newStats });
      out.push({ type: "FROG_UPDATE", id: frog.id, changes: { statsJson: newStats } });
    }

    return { success: true, data: { itemId, itemName: item.name, targetGridX: ctx.targetGridX, targetGridY: ctx.targetGridY } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog   = ctx.frog!;
    const { itemId, itemName, targetGridX: tx, targetGridY: ty } = result.data as any;

    pushActionLog({
      text:     `${frog.name} threw ${itemName} to (${tx}, ${ty})`,
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
