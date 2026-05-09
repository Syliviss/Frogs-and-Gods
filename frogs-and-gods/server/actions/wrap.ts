import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import { getFrogById, getPredatorById, updatePredator, updateFrog } from "../db";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";

// WRAP — a status action that constricts both caster and target.
//
// Queued automatically by STRIKE when the target frog survives the bite.
// This is the canonical DB write for both entity flags; STRIKE sets them
// optimistically, WRAP confirms/re-applies them at resolution.
//
// Escape mechanic:
//   The frog does NOT roll to escape here. Instead, any action the frog attempts
//   while wrappedBy is set will call rollConditionCheck() in _conditionUtils.ts,
//   which rolls the escape check and either frees them (action proceeds) or fumbles
//   the turn (frog spends it struggling). No passive sweep required.

export const wrapHandler: PredatorActionHandler = {
  async validate(ctx: PredatorActionContext, predator: Predator): Promise<PredatorActionResult> {
    const targetFrogId = ctx.payload.targetFrogId as number | undefined;
    if (typeof targetFrogId !== "number") {
      return { success: false, error: "WRAP requires targetFrogId in payload." };
    }

    const frog = await getFrogById(targetFrogId);
    if (!frog || frog.isDead) {
      return { success: false, error: "Target frog is gone or dead — wrap cancelled." };
    }

    return { success: true };
  },

  async execute(ctx: PredatorActionContext, predator: Predator): Promise<PredatorActionResult> {
    const targetFrogId = ctx.payload.targetFrogId as number;
    const frog = await getFrogById(targetFrogId);
    if (!frog || frog.isDead) {
      return { success: false, error: "Target frog is gone at resolution — wrap cancelled." };
    }

    // Re-fetch predator for fresh statsJson
    const freshPredator = await getPredatorById(predator.id);
    const stats = ((freshPredator ?? predator).statsJson ?? {}) as PredatorStats;

    await updatePredator(predator.id, {
      statsJson: { ...stats, wrapping: { targetFrogId } },
    });
    await updateFrog(frog.id, {
      statsJson: { ...frog.statsJson, wrappedBy: predator.id },
    });

    return { success: true, data: { targetFrogId, targetName: frog.name, frogOwnerId: frog.ownerId } };
  },

  async broadcast(
    _ctx: PredatorActionContext,
    predator: Predator,
    result: PredatorActionResult,
    notify: NotifyFn,
  ): Promise<void> {
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
