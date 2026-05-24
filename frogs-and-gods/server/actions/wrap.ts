import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import { getTerrainAt } from "./_utils";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

// WRAP — a status action that constricts both caster and target.
//
// Queued automatically by STRIKE when the target frog survives the bite.
// This is the canonical DB write for both entity flags; STRIKE sets them
// optimistically, WRAP confirms/re-applies them at resolution.
//
// Escape mechanic:
//   The frog does NOT roll to escape here. Instead, any action the frog attempts
//   while wrappedBy is set will call rollConditionCheck() in _utils.ts,
//   which rolls the escape check and either frees them (action proceeds) or fumbles
//   the turn (frog spends it struggling). No passive sweep required.

export const wrapHandler: PredatorActionHandler = {
  validate(ctx: PredatorActionContext, predator: Predator, state: SimulatedState): PredatorActionResult {
    const targetFrogId = ctx.payload.targetFrogId as number | undefined;
    if (typeof targetFrogId !== "number") {
      return { success: false, error: "WRAP requires targetFrogId in payload." };
    }

    const frog = state.frogs.get(targetFrogId);
    if (!frog || frog.isDead) {
      return { success: false, error: "Target frog is gone or dead — wrap cancelled." };
    }

    return { success: true };
  },

  execute(ctx: PredatorActionContext, predator: Predator, state: SimulatedState, out: UpdateInstruction[]): PredatorActionResult {
    const targetFrogId = ctx.payload.targetFrogId as number;
    const frog = state.frogs.get(targetFrogId);
    if (!frog || frog.isDead) {
      return { success: false, error: "Target frog is gone at resolution — wrap cancelled." };
    }

    // Use freshPredator from SimulatedState — may differ from the stale `predator`
    // arg if another action moved this predator earlier in the same tick.
    const freshPredator = state.predators.get(predator.id)!;
    const stats = (freshPredator.statsJson ?? {}) as PredatorStats;

    // ── Coil: teleport snake to 3 adjacent tiles around the frog ────────────
    // Ring order is clockwise starting top-left; consecutive tiles are always
    // Chebyshev-adjacent so any 3 in a row form a connected arc.
    const RING: [number, number][] = [
      [-1,-1],[0,-1],[1,-1],
      [1, 0],
      [1, 1],[0, 1],[-1, 1],
      [-1, 0],
    ];
    const fx = frog.gridX, fy = frog.gridY;
    const hx = freshPredator.gridX, hy = freshPredator.gridY;
    const neighbors = RING.map(([dx, dy]) => ({ x: fx + dx, y: fy + dy }));

    // Start from the nearest CARDINAL neighbor (N=1, E=3, S=5, W=7 in the ring).
    // Three consecutive clockwise tiles from a cardinal = [card, diag, card] = L-shape.
    const CARDINAL_INDICES = [1, 3, 5, 7];
    let startIdx = CARDINAL_INDICES[0]!;
    let minDist = Infinity;
    for (const ci of CARDINAL_INDICES) {
      const t = neighbors[ci]!;
      const d = chebyshevDistance(hx, hy, t.x, t.y);
      if (d < minDist) { minDist = d; startIdx = ci; }
    }

    const coil: { x: number; y: number }[] = [];
    for (let off = 0; off < 8 && coil.length < 3; off++) {
      const t = neighbors[(startIdx + off) % 8]!;
      const ch = getTerrainAt(state, t.x, t.y);
      if (ch === "#" || ch === "o" || ch === "T") coil.push(t);
    }
    if (coil.length < 3) {
      coil.length = 0;
      for (let off = 0; off < 8 && coil.length < 3; off++) {
        coil.push(neighbors[(startIdx + off) % 8]!);
      }
    }
    const [headTile, seg0Tile, seg1Tile] = coil as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];

    const predChanges = {
      gridX:     headTile.x,
      gridY:     headTile.y,
      chunkX:    Math.floor(headTile.x / CHUNK_SIZE),
      chunkY:    Math.floor(headTile.y / CHUNK_SIZE),
      statsJson: { ...stats, wrapping: { targetFrogId }, segments: [seg0Tile, seg1Tile] },
    };
    state.updatePredator(predator.id, predChanges);
    out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: predChanges });

    const frogChanges = { statsJson: { ...frog.statsJson, wrappedBy: predator.id } };
    state.updateFrog(frog.id, frogChanges);
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: frogChanges });

    return { success: true, data: { targetFrogId, targetName: frog.name, frogOwnerId: frog.ownerId } };
  },

  broadcast(
    _ctx: PredatorActionContext,
    predator: Predator,
    result: PredatorActionResult,
    notify: NotifyFn,
  ): void {
    if (!result.success) return;

    const { targetName, frogOwnerId } = result.data as {
      targetFrogId: number;
      targetName:   string;
      frogOwnerId:  number | null;
    };

    pushActionLog({
      text:     `Snake wraps ${targetName}! They cannot move until they break free.`,
      x:        predator.gridX,
      y:        predator.gridY,
      chunk_id: `${Math.floor(predator.gridX / CHUNK_SIZE)}:${Math.floor(predator.gridY / CHUNK_SIZE)}`,
      category: "combat",
    });

    if (frogOwnerId != null) {
      notify(frogOwnerId, { type: "SNAKE_WRAP", message: "You are constricted! Try to act to break free." });
    }
  },
};
