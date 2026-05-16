// DIV_PLACE_LAIR — Places an overworld entrance tile ("D") linked to a god's instance.
// First placement for a god is free; every subsequent placement costs 50 favor.
// The handler also stamps a world_map_overrides record so the "D" renders on the map.
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";
import { getTerrainAt } from "./_utils";

const REPEAT_FAVOR_COST = 50;
const BLOCKING_TERRAIN = ["≈"]; // deep water cannot host a lair entrance

export const divPlaceLairHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId       = ctx.payload.godId as number;
    const instanceId  = ctx.payload.instanceId as number;
    const targetGridX = ctx.payload.targetGridX as number;
    const targetGridY = ctx.payload.targetGridY as number;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };

    const instance = state.getInstance(instanceId);
    if (!instance) return { success: false, error: "Instance not found in state." };
    if (instance.ownerGodId !== godId) return { success: false, error: "Instance does not belong to this god." };
    if (!instance.tileDataJson) return { success: false, error: "Instance layout must be committed (DIV_UPDATE_LAIR) before placing an entrance." };

    const existingEntrance = state.getLairEntranceAt(targetGridX, targetGridY);
    if (existingEntrance) return { success: false, error: "A lair entrance already exists at that tile." };

    const terrain = getTerrainAt(state, targetGridX, targetGridY);
    if (BLOCKING_TERRAIN.includes(terrain)) {
      return { success: false, error: `Cannot place a lair entrance on '${terrain}' terrain.` };
    }

    // Count all existing entrances owned by this god across all their instances.
    const godEntranceCount = Array.from(state.lairEntrances.values()).filter(e => {
      const inst = state.getInstance(e.instanceId);
      return inst?.ownerGodId === godId;
    }).length;

    const isFirstPlacement = godEntranceCount === 0;
    const cost = isFirstPlacement ? 0 : REPEAT_FAVOR_COST;

    if (god.favor < cost) {
      return { success: false, error: `Insufficient favor: need ${cost}, have ${god.favor}.` };
    }

    return { success: true, data: { isFirstPlacement, cost } };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId       = ctx.payload.godId as number;
    const instanceId  = ctx.payload.instanceId as number;
    const targetGridX = ctx.payload.targetGridX as number;
    const targetGridY = ctx.payload.targetGridY as number;

    const god = state.getGod(godId)!;

    const godEntranceCount = Array.from(state.lairEntrances.values()).filter(e => {
      const inst = state.getInstance(e.instanceId);
      return inst?.ownerGodId === godId;
    }).length;

    const isFirstPlacement = godEntranceCount === 0;
    const cost = isFirstPlacement ? 0 : REPEAT_FAVOR_COST;

    out.push({
      type: "LAIR_ENTRANCE_INSERT",
      data: { instanceId, gridX: targetGridX, gridY: targetGridY },
    });

    out.push({
      type: "WORLD_MAP_OVERRIDE_INSERT",
      data: {
        chunkX:      Math.floor(targetGridX / 16),
        chunkY:      Math.floor(targetGridY / 16),
        gridX:       targetGridX,
        gridY:       targetGridY,
        newChar:     "D",
        authorGodId: godId,
      },
    });

    if (cost > 0) {
      const newFavor = god.favor - cost;
      state.updateGod(godId, { favor: newFavor });
      out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor } });
    }

    return { success: true, data: { godId, instanceId, targetGridX, targetGridY, isFirstPlacement } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { godId, instanceId, targetGridX, targetGridY } = result.data as {
      godId: number; instanceId: number; targetGridX: number; targetGridY: number; isFirstPlacement: boolean;
    };
    pushActionLog({
      text:     `God #${godId} placed lair entrance for instance #${instanceId} at (${targetGridX}, ${targetGridY})`,
      x:        targetGridX,
      y:        targetGridY,
      chunk_id: `${Math.floor(targetGridX / 16)}:${Math.floor(targetGridY / 16)}`,
      category: "god",
    });
  },
};
