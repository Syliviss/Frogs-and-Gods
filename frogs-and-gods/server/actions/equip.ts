import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

export const equipHandler: ActionHandler = {
  // @param ctx.payload.itemId - UUID of the item to equip
  // @returns FUMBLE if equip capacity exceeded, silent reject for other failures
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string | undefined;
    if (!itemId) return { ok: false, message: "itemId required in payload." };

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };

    // Item must be on the ground at the frog's tile, or already in the frog's inventory
    const onGround    = item.itemState === "GROUND" && item.gridX === frog.gridX && item.gridY === frog.gridY;
    const inInventory = item.itemState === "INVENTORY" && item.ownerId === frog.id;
    if (!onGround && !inInventory) {
      return { ok: false, message: "Item is not accessible." };
    }

    const allFrogItems = Array.from(state.items.values()).filter(i => i.ownerId === frog.id);
    const equippedCount = allFrogItems.filter(i => i.itemState === "EQUIPPED").length;

    // Equip capacity check → Fumble
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
      const invCount = allFrogItems.length;
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
    const fumble = checkItemFumble(frog.id, "EQUIP", state);
    if (fumble) return fumble;

    return { ok: true };
  },

  // @param ctx.payload.itemId - UUID of the item to equip
  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog   = ctx.frog!;
    const itemId = ctx.payload.itemId as string;
    const item = state.getItem(itemId)!;

    // Set item to EQUIPPED state
    state.updateItem(itemId, {
      itemState: "EQUIPPED",
      ownerId:   frog.id,
      gridX:     null,
      gridY:     null,
      parentContainerId: null,
    });
    out.push({ type: "ITEM_UPDATE", id: itemId, changes: {
      itemState: "EQUIPPED", ownerId: frog.id, gridX: null, gridY: null, parentContainerId: null
    }});

    // Recalculate equipped bonuses from all EQUIPPED items
    const allEquipped = Array.from(state.items.values()).filter(i => i.ownerId === frog.id && i.itemState === "EQUIPPED");
    let attackBonus   = 0;
    let defenseBonus  = 0;
    let hpBonus       = 0;
    for (const eq of allEquipped) {
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

    return { success: true, data: { itemId, itemName: item.name } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog   = ctx.frog!;
    const { itemId, itemName } = result.data as { itemId: string; itemName: string };

    pushActionLog({
      text:     `${frog.name} equipped ${itemName}`,
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
