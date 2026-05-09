import { eq } from "drizzle-orm";
import {
  getDb,
  getFrogById,
  getPredatorById,
  getPendingActionsToResolve,
  getPendingGodActions,
  getPendingPredatorActions,
} from "../db";
import { pendingActions } from "../../drizzle/schema";
import { runAction, GOD_ACTION_REGISTRY, PREDATOR_ACTION_REGISTRY } from "../actions/index";
import type { NotifyFn } from "../actions/_types";
import type { GodActionContext } from "../actions/god_types";
import type { PredatorActionContext } from "../actions/_predator_types";

async function processGodActions(bucket: number, notify: NotifyFn): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const godPending = await getPendingGodActions(bucket);
  for (const action of godPending) {
    const handler = GOD_ACTION_REGISTRY[action.actionType];
    if (!handler) {
      await db.update(pendingActions).set({ status: "resolved", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
      continue;
    }
    const ctx: GodActionContext = {
      actionType: action.actionType,
      payload:    (action.payload as Record<string, unknown>) ?? {},
    };
    const validation = await handler.validate(ctx);
    if (!validation.success) {
      console.warn(`[GodAction] ${action.actionType} validation failed: ${validation.error}`);
      await db.update(pendingActions).set({ status: "cancelled", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
      continue;
    }
    const result = await handler.execute(ctx);
    await handler.broadcast(ctx, result, notify);
    await db.update(pendingActions).set({ status: "resolved", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
  }
}

async function processPredatorActions(bucket: number, notify: NotifyFn): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const predatorPending = await getPendingPredatorActions(bucket);
  for (const action of predatorPending) {
    const handler = PREDATOR_ACTION_REGISTRY[action.actionType];
    if (!handler) {
      await db.update(pendingActions)
        .set({ status: "cancelled", resolvedAt: new Date() })
        .where(eq(pendingActions.id, action.id));
      continue;
    }
    const predator = await getPredatorById(action.actorId);
    if (!predator) {
      await db.update(pendingActions)
        .set({ status: "cancelled", resolvedAt: new Date() })
        .where(eq(pendingActions.id, action.id));
      continue;
    }
    const ctx: PredatorActionContext = {
      actionType:  action.actionType,
      actorId:     action.actorId,
      targetGridX: action.targetGridX ?? 0,
      targetGridY: action.targetGridY ?? 0,
      payload:     (action.payload as Record<string, unknown>) ?? {},
    };
    const validation = await handler.validate(ctx, predator);
    if (!validation.success) {
      await db.update(pendingActions)
        .set({ status: "cancelled", resolvedAt: new Date() })
        .where(eq(pendingActions.id, action.id));
      continue;
    }
    const result = await handler.execute(ctx, predator);
    await handler.broadcast(ctx, predator, result, notify);
    await db.update(pendingActions)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(pendingActions.id, action.id));
  }
}

export async function processAllActions(
  notify: NotifyFn = () => {},
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const currentBucket = Math.floor(Date.now() / 500);

  // Pass 1: God actions — create items/entities so they exist before other passes
  await processGodActions(currentBucket, notify);
  // Pass 2: Predator actions — SLITHER, STRIKE, WRAP resolve before the frog DEX pass
  await processPredatorActions(currentBucket, notify);

  const pending = await getPendingActionsToResolve(currentBucket);
  if (pending.length === 0) return;

  // Fetch DEX for each actor to sort higher-DEX frogs first
  const dexMap = new Map<number, number>();
  await Promise.all(
    Array.from(new Set(pending.map((a) => a.actorId))).map(async (actorId) => {
      const frog = await getFrogById(actorId);
      dexMap.set(actorId, frog?.statsJson.dex ?? 0);
    })
  );

  const sorted = [...pending].sort((a, b) => (dexMap.get(b.actorId) ?? 0) - (dexMap.get(a.actorId) ?? 0));

  for (const action of sorted) {
    // Skip FUMBLE sentinel rows (inserted by runAction on fumble)
    if (action.actionType === "FUMBLE") {
      await db.update(pendingActions)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(pendingActions.id, action.id));
      continue;
    }

    await runAction(
      {
        frogId:      action.actorId,
        userId:      0, // userId resolved from frog.ownerId inside handlers
        actionType:  action.actionType,
        payload:     (action.payload as Record<string, unknown>) ?? {},
        targetGridX: action.targetGridX ?? undefined,
        targetGridY: action.targetGridY ?? undefined,
      },
      notify,
    );

    // Mark the pending_action row resolved (runAction inserts its own sentinel on fumble)
    await db.update(pendingActions)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(pendingActions.id, action.id));
  }
}

// Keep the old export name alive so socket.ts import doesn't break during transition
export { processAllActions as processMovementActions };
