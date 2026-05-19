import {
  chebyshevDistance,
  getHopPath,
  getLineTiles,
  OPEN_WATER_TILES,
  SWIM_PASSABLE_TILES,
  type MoveType,
} from "../../shared/movement";
import type { TileChar } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import { getTerrainAt, rollConditionCheck, checkItemFumble } from "./_utils";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { CHUNK_SIZE } from "../utils/worldGenerator";

// Returns the terrain char for each tile in the given list.
function getTerrainPath(state: SimulatedState, tiles: { x: number; y: number }[]): TileChar[] {
  return tiles.map(({ x, y }) => getTerrainAt(state, x, y));
}

function sharedPreamble(ctx: ActionContext, state: SimulatedState): ValidationResult {
  const frog = ctx.frog!;
  const scratchOut: UpdateInstruction[] = [];
  const condition = rollConditionCheck(frog, state, scratchOut);
  if (!condition.ok) return condition;
  const fumble = checkItemFumble(frog.id, ctx.actionType, state);
  if (fumble) return fumble;
  if (ctx.targetGridX == null || ctx.targetGridY == null) {
    return { ok: false, message: "Target coordinates required." };
  }
  return { ok: true };
}

// ─── STEP ────────────────────────────────────────────────────────────────────
// Free. Moves 1 tile in any direction. Cannot land on ^.

export const stepHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const pre = sharedPreamble(ctx, state);
    if (!pre.ok) return pre;

    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;

    const dist = chebyshevDistance(frog.gridX, frog.gridY, tx, ty);
    if (dist > 1) return { ok: false, message: "STEP max range is 1 tile." };

    const targetChar = getTerrainAt(state, tx, ty);
    if (targetChar === "^") return { ok: false, message: "Cannot step onto a Peak." };

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;

    rollConditionCheck(state.getFrog(frog.id) ?? frog, state, out);

    state.updateFrog(frog.id, { gridX: tx, gridY: ty });
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: { gridX: tx, gridY: ty } });

    return { success: true, data: { targetGridX: tx, targetGridY: ty } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;
    pushActionLog({
      text:     `${frog.name} steps to (${tx}, ${ty})`,
      x:        tx,
      y:        ty,
      chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
      category: "movement",
    });
    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ACTION_RESOLVED", actionType: "STEP", legal: true, targetGridX: tx, targetGridY: ty });
    }
  },
};

// ─── HOP ─────────────────────────────────────────────────────────────────────
// Costs breath = distance (1–3 tiles). Fumble if breath insufficient or path/dest is ^.

export const hopHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const pre = sharedPreamble(ctx, state);
    if (!pre.ok) return pre;

    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;

    const dist = chebyshevDistance(frog.gridX, frog.gridY, tx, ty);
    if (dist > 3) return { ok: false, message: "HOP max range is 3 tiles." };
    if (dist === 0) return { ok: false, message: "Must hop to a different tile." };

    // ^ anywhere along the path (including destination) → fumble
    const path = getHopPath(frog.gridX, frog.gridY, tx, ty);
    const pathChars = getTerrainPath(state, path);
    if (pathChars.some(c => c === "^")) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name} tumbles into a peak!`,
      };
    }

    // Insufficient breath → fumble
    if ((frog.currentBreath ?? 0) < dist) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `${frog.name} doesn't have enough breath to hop!`,
      };
    }

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;
    const dist = chebyshevDistance(frog.gridX, frog.gridY, tx, ty);

    rollConditionCheck(state.getFrog(frog.id) ?? frog, state, out);

    const newBreath = (frog.currentBreath ?? 0) - dist;
    state.updateFrog(frog.id, { gridX: tx, gridY: ty, currentBreath: newBreath });
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: { gridX: tx, gridY: ty, currentBreath: newBreath } });

    return { success: true, data: { targetGridX: tx, targetGridY: ty } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;
    pushActionLog({
      text:     `${frog.name} hops to (${tx}, ${ty})`,
      x:        tx,
      y:        ty,
      chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
      category: "movement",
    });
    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ACTION_RESOLVED", actionType: "HOP", legal: true, targetGridX: tx, targetGridY: ty });
    }
  },
};

// ─── SWIM ─────────────────────────────────────────────────────────────────────
// Available only from open water (≈ ~). Straight line, costs breath per tile.
// Intermediate tiles must be swim-passable. Can exit to 1 adjacent non-^ land tile.

export const swimHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const pre = sharedPreamble(ctx, state);
    if (!pre.ok) return pre;

    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;

    // Must be standing in open water to swim.
    const standingChar = getTerrainAt(state, frog.gridX, frog.gridY);
    if (!OPEN_WATER_TILES.has(standingChar)) {
      return { ok: false, message: "SWIM is only available from open water." };
    }

    const dist = chebyshevDistance(frog.gridX, frog.gridY, tx, ty);
    if (dist === 0) return { ok: false, message: "Must swim to a different tile." };

    // Breath check (Bresenham path length equals chebyshev distance for all cases).
    if ((frog.currentBreath ?? 0) < dist) {
      return { ok: false, message: `${frog.name} doesn't have enough breath to swim that far.` };
    }

    // Walk the Bresenham line: intermediate tiles must be swim-passable;
    // destination may be swim-passable OR exactly 1 adjacent non-^ land tile.
    const path = getLineTiles(frog.gridX, frog.gridY, tx, ty);
    for (let i = 0; i < path.length; i++) {
      const { x, y } = path[i];
      const char = getTerrainAt(state, x, y);
      const isLast = i === path.length - 1;
      if (!isLast) {
        if (!SWIM_PASSABLE_TILES.has(char)) {
          return { ok: false, message: "SWIM path is blocked by land." };
        }
      } else {
        if (!SWIM_PASSABLE_TILES.has(char)) {
          if (char === "^") return { ok: false, message: "Cannot swim onto a Peak." };
          // Non-^ land tile is allowed as the exit tile.
        }
      }
    }

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;
    const dist = chebyshevDistance(frog.gridX, frog.gridY, tx, ty);

    rollConditionCheck(state.getFrog(frog.id) ?? frog, state, out);

    const newBreath = (frog.currentBreath ?? 0) - dist;
    state.updateFrog(frog.id, { gridX: tx, gridY: ty, currentBreath: newBreath });
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: { gridX: tx, gridY: ty, currentBreath: newBreath } });

    return { success: true, data: { targetGridX: tx, targetGridY: ty } };
  },

  async broadcast(ctx: ActionContext, _result: ExecuteResult, notify: NotifyFn): Promise<void> {
    const frog = ctx.frog!;
    const tx = ctx.targetGridX!;
    const ty = ctx.targetGridY!;
    pushActionLog({
      text:     `${frog.name} swims to (${tx}, ${ty})`,
      x:        tx,
      y:        ty,
      chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
      category: "movement",
    });
    if (frog.ownerId != null) {
      notify(frog.ownerId, { type: "ACTION_RESOLVED", actionType: "SWIM", legal: true, targetGridX: tx, targetGridY: ty });
    }
  },
};
