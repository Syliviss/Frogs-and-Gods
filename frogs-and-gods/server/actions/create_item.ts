import { createItem } from "../db";
import { pushActionLog } from "../engine/actionLog";
import { CreateItemPayloadSchema } from "../../shared/game.schema";
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";

export const createItemHandler: GodActionHandler = {
  async validate(ctx: GodActionContext): Promise<GodActionResult> {
    const result = CreateItemPayloadSchema.safeParse(ctx.payload);
    if (!result.success) {
      return { success: false, error: result.error.issues[0]?.message ?? "Invalid payload" };
    }
    return { success: true };
  },

  async execute(ctx: GodActionContext): Promise<GodActionResult> {
    const { name, statsJson, pixelData, itemType, rarityTier } = CreateItemPayloadSchema.parse(ctx.payload);
    // description is accepted but not yet persisted — no DB column yet
    const item = await createItem({
      itemId:    crypto.randomUUID(),
      name,
      rarityTier,
      statsJson,
      itemState: "VOID",
      itemType,
      pixelData: pixelData ?? null,
    });
    return { success: true, data: { item } };
  },

  async broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): Promise<void> {
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
