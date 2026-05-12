import { pushActionLog } from "../engine/actionLog";
import { CreateItemPayloadSchema } from "../../shared/game.schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import crypto from "crypto";

export const createItemHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const result = CreateItemPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    return { success: true };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const { name, statsJson, pixelData, itemType, rarityTier } = CreateItemPayloadSchema.parse(ctx.payload);
    const newItem = {
      itemId:    crypto.randomUUID(),
      name,
      rarityTier,
      statsJson,
      itemState: "VOID",
      itemType,
      pixelData: pixelData ?? null,
      ownerId: null,
      gridX: null,
      gridY: null,
      parentContainerId: null,
    };
    
    state.items.set(newItem.itemId, newItem as any);
    out.push({ type: "ITEM_INSERT", data: newItem });
    return { success: true, data: { item: newItem } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    const { name } = ctx.payload as { name: string };
    pushActionLog({
      text:     `Item created: ${name}`,
      x:        0,
      y:        0,
      chunk_id: "0:0",
      category: "god",
    });
  },
};
