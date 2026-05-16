// OPEN_DOOR — Frog traversal action for entering and exiting God's Lair instances.
// Mode 1 (Enter): frog is in overworld (instanceId=null) and stands on a lair entrance "D" tile.
//   → Teleports frog into the instance at the local coordinates of the "D" tile in its layout.
// Mode 2 (Exit): frog is inside an instance (instanceId !== null) and stands on the "D" tile.
//   → Returns frog to the overworld entrance coordinates.
import type { ActionHandler, ActionContext, ValidationResult, ExecuteResult } from "./_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";
import { CHUNK_SIZE } from "../utils/worldGenerator";

const GRID_SIZE = 16;

function findDTileInLayout(tileDataJson: string): { x: number; y: number } | null {
  try {
    const grid: string[][] = JSON.parse(tileDataJson);
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (grid[r]?.[c] === "D") return { x: c, y: r };
      }
    }
  } catch {
    // malformed JSON — treat as no door
  }
  return null;
}

export const openDoorHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog = ctx.frog!;

    if (frog.instanceId == null) {
      // Mode 1: entering a lair from the overworld
      const entrance = state.getLairEntranceAt(frog.gridX, frog.gridY);
      if (!entrance) return { ok: false }; // silent reject — not standing on a door

      const instance = state.getInstance(entrance.instanceId);
      if (!instance || !instance.tileDataJson) {
        return { ok: false, message: "Lair entrance exists but the lair has no committed layout." };
      }

      const dTile = findDTileInLayout(instance.tileDataJson);
      if (!dTile) {
        return { ok: false, message: "Lair layout is missing a 'D' spawn tile." };
      }

      return { ok: true };
    } else {
      // Mode 2: exiting a lair back to the overworld
      const instance = state.getInstance(frog.instanceId);
      if (!instance || !instance.tileDataJson) return { ok: false };

      const dTile = findDTileInLayout(instance.tileDataJson);
      if (!dTile || dTile.x !== frog.gridX || dTile.y !== frog.gridY) {
        return { ok: false }; // silent reject — frog is not standing on the exit "D"
      }

      const entrances = state.getLairEntrancesForInstance(frog.instanceId);
      if (entrances.length === 0) {
        return { ok: false, message: "No overworld entrance found for this lair." };
      }

      return { ok: true };
    }
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;

    if (frog.instanceId == null) {
      // Mode 1: enter the lair
      const entrance = state.getLairEntranceAt(frog.gridX, frog.gridY)!;
      const instance = state.getInstance(entrance.instanceId)!;
      const dTile = findDTileInLayout(instance.tileDataJson!)!;

      state.updateFrog(frog.id, { instanceId: entrance.instanceId, gridX: dTile.x, gridY: dTile.y });
      out.push({
        type:    "FROG_UPDATE",
        id:      frog.id,
        changes: { instanceId: entrance.instanceId, gridX: dTile.x, gridY: dTile.y },
      });

      return { success: true, data: { mode: "enter", instanceId: entrance.instanceId, localX: dTile.x, localY: dTile.y } };
    } else {
      // Mode 2: exit back to overworld
      const entrances = state.getLairEntrancesForInstance(frog.instanceId);
      const entrance = entrances[0]!;

      state.updateFrog(frog.id, { instanceId: null, gridX: entrance.gridX, gridY: entrance.gridY });
      out.push({
        type:    "FROG_UPDATE",
        id:      frog.id,
        changes: { instanceId: null, gridX: entrance.gridX, gridY: entrance.gridY },
      });

      return { success: true, data: { mode: "exit", gridX: entrance.gridX, gridY: entrance.gridY } };
    }
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const frog = ctx.frog!;
    const data = result.data as { mode: string; instanceId?: number; gridX?: number; gridY?: number };
    const entering = data.mode === "enter";

    const logX = entering ? (frog.gridX) : (data.gridX ?? 0);
    const logY = entering ? (frog.gridY) : (data.gridY ?? 0);

    pushActionLog({
      text:     `${frog.name} ${entering ? "enters" : "exits"} the God's Lair`,
      x:        logX,
      y:        logY,
      chunk_id: `${Math.floor(logX / CHUNK_SIZE)}:${Math.floor(logY / CHUNK_SIZE)}`,
      category: "movement",
    });

    if (frog.ownerId != null) {
      notify(frog.ownerId, {
        type:       "OPEN_DOOR",
        mode:       data.mode,
        frogId:     frog.id,
        instanceId: data.instanceId ?? null,
      });
    }
  },
};
