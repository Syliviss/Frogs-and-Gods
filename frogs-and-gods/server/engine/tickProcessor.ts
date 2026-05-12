import { and, eq, inArray, sql } from "drizzle-orm";
import {
  getDb,
  getPendingActionsToResolve,
  getPendingGodActions,
  getPendingPredatorActions,
  getChunksInBoundingBox,
  getFrogsInBounds,
  getPredatorsInChunkArea,
  getItemsInBounds
} from "../db";
import { pendingActions, worldLogEvents, frogs, predators, items } from "../../drizzle/schema";
import { runAction, GOD_ACTION_REGISTRY, PREDATOR_ACTION_REGISTRY, ACTION_REGISTRY } from "../actions/index";
import type { NotifyFn, ActionContext } from "../actions/_types";
import type { GodActionContext } from "../actions/god_types";
import type { PredatorActionContext } from "../actions/_predator_types";
import { SimulatedState, type UpdateInstruction } from "./types";

export async function processAllActions(notify: NotifyFn = () => {}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const currentBucket = Math.floor(Date.now() / 500);

  // 1. Fetch all pending actions for this bucket
  const mortalActions = await getPendingActionsToResolve(currentBucket);
  const godActions = await getPendingGodActions(currentBucket);
  const aiActions = await getPendingPredatorActions(currentBucket);

  const allPending = [...mortalActions, ...godActions, ...aiActions];
  if (allPending.length === 0) return;

  // 2. The Great Inhale
  const state = new SimulatedState();
  
  let minGX = Infinity, maxGX = -Infinity;
  let minGY = Infinity, maxGY = -Infinity;
  const actorIds = new Set<number>();
  const predatorActorIds = new Set<number>();

  for (const a of allPending) {
    if (a.actorId) {
      if (PREDATOR_ACTION_REGISTRY[a.actionType]) predatorActorIds.add(a.actorId);
      else actorIds.add(a.actorId);
    }
    if (a.targetGridX != null) {
      minGX = Math.min(minGX, a.targetGridX);
      maxGX = Math.max(maxGX, a.targetGridX);
    }
    if (a.targetGridY != null) {
      minGY = Math.min(minGY, a.targetGridY);
      maxGY = Math.max(maxGY, a.targetGridY);
    }
  }

  // Fetch actor frogs to expand bounds
  if (actorIds.size > 0) {
    const fetchedFrogs = await db.select().from(frogs).where(inArray(frogs.id, Array.from(actorIds)));
    for (const f of fetchedFrogs) {
      minGX = Math.min(minGX, f.gridX);
      maxGX = Math.max(maxGX, f.gridX);
      minGY = Math.min(minGY, f.gridY);
      maxGY = Math.max(maxGY, f.gridY);
      state.frogs.set(f.id, f);
    }
  }

  // Pad the bounding box slightly for AoE
  if (minGX !== Infinity) {
    minGX -= 5; maxGX += 5;
    minGY -= 5; maxGY += 5;

    // Fetch spatial entities
    const areaFrogs = await getFrogsInBounds(minGX, maxGX, minGY, maxGY);
    for (const f of areaFrogs) state.frogs.set(f.id, f);

    const areaItems = await getItemsInBounds(minGX, maxGX, minGY, maxGY);
    for (const i of areaItems) state.items.set(i.itemId, i);

    if (actorIds.size > 0) {
      const actorItems = await db.select().from(items).where(inArray(items.ownerId, Array.from(actorIds)));
      for (const i of actorItems) state.items.set(i.itemId, i);
    }

    const minCX = Math.floor(minGX / 16);
    const maxCX = Math.floor(maxGX / 16);
    const minCY = Math.floor(minGY / 16);
    const maxCY = Math.floor(maxGY / 16);

    const chunkCoords = [];
    for (let x = minCX; x <= maxCX; x++) {
      for (let y = minCY; y <= maxCY; y++) chunkCoords.push({ chunkX: x, chunkY: y });
    }

    const areaPredators = await getPredatorsInChunkArea(chunkCoords);
    for (const p of areaPredators) state.predators.set(p.id, p);

    const areaChunks = await getChunksInBoundingBox(minCX, maxCX, minCY, maxCY);
    for (const c of areaChunks) state.chunks.set(`${c.chunkX},${c.chunkY}`, c);
  }

  // 3. Predator AI Injection
  // (Left as a placeholder for the explicit AI tick integration later)

  // 4. Sequential Sorting
  allPending.sort((a, b) => {
    const aIsGod = !!GOD_ACTION_REGISTRY[a.actionType];
    const bIsGod = !!GOD_ACTION_REGISTRY[b.actionType];
    if (aIsGod && !bIsGod) return -1;
    if (!aIsGod && bIsGod) return 1;

    let initA = 0, initB = 0;
    const frogA = state.getFrog(a.actorId);
    if (frogA) initA = frogA.statsJson.dex ?? 0;
    const predA = state.getPredator(a.actorId);
    if (predA) initA = predA.statsJson?.speed ?? 0;

    const frogB = state.getFrog(b.actorId);
    if (frogB) initB = frogB.statsJson.dex ?? 0;
    const predB = state.getPredator(b.actorId);
    if (predB) initB = predB.statsJson?.speed ?? 0;

    return initB - initA;
  });

  // 5. The Living Ledger
  const updateQueue: UpdateInstruction[] = [];
  const handledActorsThisTick = new Set<number>();

  for (const action of allPending) {
    if (action.actionType === "FUMBLE") {
      updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
      continue;
    }

    if (GOD_ACTION_REGISTRY[action.actionType]) {
      const handler = GOD_ACTION_REGISTRY[action.actionType];
      const ctx: GodActionContext = { actionType: action.actionType, payload: (action.payload as Record<string, unknown>) ?? {} };
      const validation = await handler.validate(ctx, state);
      if (!validation.success) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        continue;
      }
      const result = await handler.execute(ctx, state, updateQueue);
      await handler.broadcast(ctx, result, notify);
      updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
    } 
    else if (PREDATOR_ACTION_REGISTRY[action.actionType]) {
      const handler = PREDATOR_ACTION_REGISTRY[action.actionType];
      const predator = state.getPredator(action.actorId);
      if (!predator || predator.currentHp <= 0) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        continue;
      }
      const ctx: PredatorActionContext = {
        actionType: action.actionType, actorId: action.actorId,
        targetGridX: action.targetGridX ?? 0, targetGridY: action.targetGridY ?? 0,
        payload: (action.payload as Record<string, unknown>) ?? {}
      };
      const validation = await handler.validate(ctx, predator, state);
      if (!validation.success) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        continue;
      }
      const result = await handler.execute(ctx, predator, state, updateQueue);
      await handler.broadcast(ctx, predator, result, notify);
      // fumble:true = miss/wasted turn — RESOLVE so turn is consumed, not silently dropped
      if (!result.success && result.fumble) {
        updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
      } else if (!result.success) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
      } else {
        updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
      }
    } 
    else if (ACTION_REGISTRY[action.actionType]) {
      const handler = ACTION_REGISTRY[action.actionType];
      if (handledActorsThisTick.has(action.actorId)) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        continue; // Heartbeat dedup
      }
      const frog = state.getFrog(action.actorId);
      if (!frog || frog.isDead) {
        updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        continue;
      }
      handledActorsThisTick.add(action.actorId);

      const ctx: ActionContext = {
        frogId: frog.id, userId: frog.ownerId, actionType: action.actionType,
        targetGridX: action.targetGridX ?? undefined, targetGridY: action.targetGridY ?? undefined,
        payload: (action.payload as Record<string, unknown>) ?? {}, frog
      };

      const validation = await handler.validate(ctx, state);
      if (!validation.ok) {
        if (validation.code === "FUMBLE") {
          updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
          notify(frog.ownerId!, { type: "FUMBLE", message: validation.message ?? "Fumble!" });
        } else {
          updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
        }
        continue;
      }

      const result = await handler.execute(ctx, state, updateQueue);
      await handler.broadcast(ctx, result, notify);
      updateQueue.push({ type: "ACTION_RESOLVE", id: action.id });
    } else {
      updateQueue.push({ type: "ACTION_CANCEL", id: action.id });
    }
  }

  // 6. The Great Exhale
  if (updateQueue.length === 0) return;

  await db.transaction(async (tx) => {
    // Compile updates
    const frogUpdates = new Map<number, Partial<typeof frogs.$inferInsert>>();
    const predatorUpdates = new Map<number, Partial<typeof predators.$inferInsert>>();
    const itemUpdates = new Map<string, Partial<typeof items.$inferInsert>>();
    const itemsToInsert: (typeof items.$inferInsert)[] = [];
    const predatorsToInsert: (typeof predators.$inferInsert)[] = [];
    const predatorsToDelete = new Set<number>();
    const actionsToInsert: (typeof pendingActions.$inferInsert)[] = [];
    const logsToInsert: (typeof worldLogEvents.$inferInsert)[] = [];
    const resolvedActions = new Set<number>();
    const cancelledActions = new Set<number>();

    for (const inst of updateQueue) {
      if (inst.type === "FROG_UPDATE") {
        const id = inst.id as number;
        frogUpdates.set(id, { ...frogUpdates.get(id), ...inst.changes });
      } else if (inst.type === "PREDATOR_UPDATE") {
        const id = inst.id as number;
        predatorUpdates.set(id, { ...predatorUpdates.get(id), ...inst.changes });
      } else if (inst.type === "ITEM_UPDATE") {
        const id = inst.id as string;
        itemUpdates.set(id, { ...itemUpdates.get(id), ...inst.changes });
      } else if (inst.type === "ITEM_INSERT") {
        itemsToInsert.push(inst.data);
      } else if (inst.type === "PREDATOR_INSERT") {
        predatorsToInsert.push(inst.data);
      } else if (inst.type === "PREDATOR_DELETE") {
        predatorsToDelete.add(inst.id as number);
      } else if (inst.type === "ACTION_INSERT") {
        actionsToInsert.push(inst.data);
      } else if (inst.type === "WORLD_LOG_INSERT") {
        logsToInsert.push(inst.data);
      } else if (inst.type === "ACTION_RESOLVE") {
        resolvedActions.add(inst.id as number);
      } else if (inst.type === "ACTION_CANCEL") {
        cancelledActions.add(inst.id as number);
      }
    }

    // Execute bulk statements
    for (const [id, changes] of frogUpdates) {
      await tx.update(frogs).set(changes).where(eq(frogs.id, id));
    }
    for (const [id, changes] of predatorUpdates) {
      await tx.update(predators).set(changes).where(eq(predators.id, id));
    }
    for (const [id, changes] of itemUpdates) {
      await tx.update(items).set(changes).where(eq(items.itemId, id));
    }
    if (itemsToInsert.length > 0) {
      await tx.insert(items).values(itemsToInsert);
    }
    if (predatorsToInsert.length > 0) {
      await tx.insert(predators).values(predatorsToInsert);
    }
    for (const id of predatorsToDelete) {
      await tx.delete(predators).where(eq(predators.id, id));
    }
    if (actionsToInsert.length > 0) {
      await tx.insert(pendingActions).values(actionsToInsert);
    }
    if (logsToInsert.length > 0) {
      await tx.insert(worldLogEvents).values(logsToInsert);
    }
    if (resolvedActions.size > 0) {
      await tx.update(pendingActions).set({ status: "resolved", resolvedAt: new Date() })
        .where(inArray(pendingActions.id, Array.from(resolvedActions)));
    }
    if (cancelledActions.size > 0) {
      await tx.update(pendingActions).set({ status: "cancelled", resolvedAt: new Date() })
        .where(inArray(pendingActions.id, Array.from(cancelledActions)));
    }
  });
}

export { processAllActions as processMovementActions };
