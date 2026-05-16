// DIV_UPDATE_LAIR — Promotes a pre-staged 16×16 ASCII grid into the instance's committed layout.
// The tRPC router writes tile data to instances.stagedTileDataJson BEFORE queueing this action.
// This handler validates the staged grid (exactly one "D"), computes the favor cost (5 per
// changed tile vs the current committed layout), and atomically commits it via the Exhale pipeline.
import type { GodActionHandler, GodActionContext, GodActionResult } from "./god_types";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { pushActionLog } from "../engine/actionLog";

const FAVOR_COST_PER_TILE = 5;
const GRID_SIZE = 16;

function parseGrid(json: string | null | undefined): string[][] | null {
  if (!json) return null;
  try {
    const g = JSON.parse(json);
    if (!Array.isArray(g) || g.length !== GRID_SIZE) return null;
    if (!g.every((row: unknown) => Array.isArray(row) && (row as unknown[]).length === GRID_SIZE)) return null;
    return g as string[][];
  } catch {
    return null;
  }
}

function countTile(grid: string[][], char: string): number {
  return grid.flat().filter(c => c === char).length;
}

function diffTiles(a: string[][], b: string[][]): number {
  let count = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (a[r]![c] !== b[r]![c]) count++;
    }
  }
  return count;
}

export const divUpdateLairHandler: GodActionHandler = {
  validate(ctx: GodActionContext, state: SimulatedState): GodActionResult {
    const godId = ctx.payload.godId as number;
    const instanceId = ctx.payload.instanceId as number;

    const god = state.getGod(godId);
    if (!god) return { success: false, error: "God not found in state." };

    const instance = state.getInstance(instanceId);
    if (!instance) return { success: false, error: "Instance not found in state." };
    if (instance.ownerGodId !== godId) return { success: false, error: "Instance does not belong to this god." };

    const staged = parseGrid(instance.stagedTileDataJson);
    if (!staged) return { success: false, error: "Staged tile data is missing or invalid (must be 16×16)." };

    const dCount = countTile(staged, "D");
    if (dCount !== 1) return { success: false, error: `Staged layout must contain exactly 1 'D' tile (found ${dCount}).` };

    const current = parseGrid(instance.tileDataJson);
    const changedTiles = current ? diffTiles(staged, current) : 0;
    const cost = changedTiles * FAVOR_COST_PER_TILE;

    if (god.favor < cost) {
      return { success: false, error: `Insufficient favor: need ${cost} (${changedTiles} tiles × ${FAVOR_COST_PER_TILE}), have ${god.favor}.` };
    }

    return { success: true, data: { cost, changedTiles } };
  },

  execute(ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]): GodActionResult {
    const godId = ctx.payload.godId as number;
    const instanceId = ctx.payload.instanceId as number;

    const god = state.getGod(godId)!;
    const instance = state.getInstance(instanceId)!;

    // Capture stagedTileDataJson as a local variable BEFORE calling state.updateInstance.
    // SimulatedState.updateInstance uses Object.assign() which mutates the object in place —
    // reading instance.stagedTileDataJson after the call would return null.
    const stagedJson = instance.stagedTileDataJson!;
    const staged = parseGrid(stagedJson)!;
    const current = parseGrid(instance.tileDataJson);
    const changedTiles = current ? diffTiles(staged, current) : 0;
    const cost = changedTiles * FAVOR_COST_PER_TILE;

    const newFavor = god.favor - cost;
    state.updateGod(godId, { favor: newFavor });
    if (cost > 0) {
      out.push({ type: "GOD_UPDATE", id: godId, changes: { favor: newFavor } });
    }

    state.updateInstance(instanceId, { tileDataJson: stagedJson, stagedTileDataJson: null });
    out.push({
      type: "INSTANCE_UPDATE",
      id: instanceId,
      changes: { tileDataJson: stagedJson, stagedTileDataJson: null },
    });

    return { success: true, data: { godId, instanceId, changedTiles, cost } };
  },

  broadcast(ctx: GodActionContext, result: GodActionResult, _notify: NotifyFn): void {
    if (!result.success || !result.data) return;
    const { godId, instanceId, changedTiles } = result.data as { godId: number; instanceId: number; changedTiles: number; cost: number };
    pushActionLog({
      text:     `God #${godId} committed lair layout for instance #${instanceId} (${changedTiles} tiles changed)`,
      x:        0,
      y:        0,
      chunk_id: "0:0",
      category: "god",
    });
  },
};
