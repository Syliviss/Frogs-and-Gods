import { and, eq, inArray, sql } from "drizzle-orm";
import {
  getDb,
  getPendingActionsToResolve,
  getPendingGodActions,
  getPendingPredatorActions,
  getChunksInBoundingBox,
  getFrogsInBounds,
  getPredatorsInChunkArea,
  getItemsInBounds,
  getInstancesByIds,
  getFrogsByInstanceId,
  getPredatorsByInstanceId,
  getItemsByInstanceId,
  getLairEntrancesByGridPositions,
  getLairEntrancesByInstanceId,
  getLairEntrancesByOwnerGodId,
  getInstanceById,
} from "../db";
import { pendingActions, worldLogEvents, frogs, predators, items, gods, instances, lairEntrances, worldMapOverrides } from "../../drizzle/schema";
import { runAction, GOD_ACTION_REGISTRY, PREDATOR_ACTION_REGISTRY, ACTION_REGISTRY } from "../actions/index";
import type { NotifyFn, ActionContext } from "../actions/_types";
import type { GodActionContext } from "../actions/god_types";
import type { PredatorActionContext } from "../actions/_predator_types";
import { SimulatedState, type UpdateInstruction } from "./types";
import { pushActionLog } from "./actionLog";
import { CHUNK_SIZE } from "../utils/worldGenerator";

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

  // 2. The Great Inhale — per-actor neighborhoods instead of one global bounding box
  const state = new SimulatedState();

  // Partition actions by actor type so each actor gets its own small spatial query.
  const frogActionMap     = new Map<number, typeof allPending>();
  const predatorActionMap = new Map<number, typeof allPending>();
  const godActionsWithPos: typeof allPending = [];

  for (const a of allPending) {
    if (GOD_ACTION_REGISTRY[a.actionType]) {
      if (a.targetGridX != null && a.targetGridY != null) godActionsWithPos.push(a);
    } else if (PREDATOR_ACTION_REGISTRY[a.actionType]) {
      if (a.actorId) {
        if (!predatorActionMap.has(a.actorId)) predatorActionMap.set(a.actorId, []);
        predatorActionMap.get(a.actorId)!.push(a);
      }
    } else {
      if (a.actorId) {
        if (!frogActionMap.has(a.actorId)) frogActionMap.set(a.actorId, []);
        frogActionMap.get(a.actorId)!.push(a);
      }
    }
  }

  // Fetch actor rows to get their positions.
  if (frogActionMap.size > 0) {
    const fetchedFrogs = await db.select().from(frogs).where(inArray(frogs.id, Array.from(frogActionMap.keys())));
    for (const f of fetchedFrogs) state.frogs.set(f.id, f);
  }
  if (predatorActionMap.size > 0) {
    const fetchedPreds = await db.select().from(predators).where(inArray(predators.id, Array.from(predatorActionMap.keys())));
    for (const p of fetchedPreds) state.predators.set(p.id, p);
  }

  // Compute the bounding box for one actor: their position plus all their action targets, padded.
  function actorBox(cx: number, cy: number, actions: typeof allPending, pad = 5) {
    let minX = cx, maxX = cx, minY = cy, maxY = cy;
    for (const a of actions) {
      if (a.targetGridX != null) { minX = Math.min(minX, a.targetGridX); maxX = Math.max(maxX, a.targetGridX); }
      if (a.targetGridY != null) { minY = Math.min(minY, a.targetGridY); maxY = Math.max(maxY, a.targetGridY); }
    }
    return { minGX: minX - pad, maxGX: maxX + pad, minGY: minY - pad, maxGY: maxY + pad };
  }

  // Run the four spatial queries for one neighborhood and merge results into state.
  async function loadNeighborhood(box: ReturnType<typeof actorBox>) {
    const { minGX, maxGX, minGY, maxGY } = box;
    const minCX = Math.floor(minGX / CHUNK_SIZE), maxCX = Math.floor(maxGX / CHUNK_SIZE);
    const minCY = Math.floor(minGY / CHUNK_SIZE), maxCY = Math.floor(maxGY / CHUNK_SIZE);
    const chunkCoords: { chunkX: number; chunkY: number }[] = [];
    for (let x = minCX; x <= maxCX; x++)
      for (let y = minCY; y <= maxCY; y++) chunkCoords.push({ chunkX: x, chunkY: y });

    const [areaFrogs, areaItems, areaPredators, areaChunks] = await Promise.all([
      getFrogsInBounds(minGX, maxGX, minGY, maxGY),
      getItemsInBounds(minGX, maxGX, minGY, maxGY),
      getPredatorsInChunkArea(chunkCoords),
      getChunksInBoundingBox(minCX, maxCX, minCY, maxCY),
    ]);
    for (const f of areaFrogs) state.frogs.set(f.id, f);
    for (const i of areaItems) state.items.set(i.itemId, i);
    for (const p of areaPredators) state.predators.set(p.id, p);
    for (const c of areaChunks) state.chunks.set(`${c.chunkX},${c.chunkY}`, c);
  }

  // Dispatch all neighborhoods in parallel. SimulatedState uses Maps, so overlapping
  // results from nearby actors are harmless (same entity just overwrites itself).
  const neighborhoodJobs: Promise<void>[] = [];
  for (const [frogId, actions] of Array.from(frogActionMap)) {
    const frog = state.frogs.get(frogId);
    if (frog) neighborhoodJobs.push(loadNeighborhood(actorBox(frog.gridX, frog.gridY, actions)));
  }
  for (const [predId, actions] of Array.from(predatorActionMap)) {
    const pred = state.predators.get(predId);
    if (pred) neighborhoodJobs.push(loadNeighborhood(actorBox(pred.gridX, pred.gridY, actions)));
  }
  // God actions with explicit target coords need local context loaded around that position.
  // God actions that work purely by entity ID skip this — entities are preloaded by ID below.
  for (const a of godActionsWithPos) {
    neighborhoodJobs.push(loadNeighborhood(actorBox(a.targetGridX!, a.targetGridY!, [a])));
  }
  await Promise.all(neighborhoodJobs);

  // Load items owned (carried) by frog actors — these are off-grid and won't appear in spatial queries.
  if (frogActionMap.size > 0) {
    const actorItems = await db.select().from(items).where(inArray(items.ownerId, Array.from(frogActionMap.keys())));
    for (const i of actorItems) state.items.set(i.itemId, i);
  }

  // Preload items referenced in god action payloads — they may be off-grid (e.g. VAULT state)
  // and won't appear in the spatial getItemsInBounds query above.
  const godPayloadItemIds: string[] = [];
  for (const a of godActions) {
    const p = a.payload as Record<string, unknown> | null;
    if (typeof p?.itemId === "string") godPayloadItemIds.push(p.itemId);
  }
  if (godPayloadItemIds.length > 0) {
    const godItems = await db.select().from(items).where(inArray(items.itemId, godPayloadItemIds));
    for (const i of godItems) state.items.set(i.itemId, i);
  }

  // Preload predators referenced in god action payloads (e.g. KILL_PREDATOR targeting by ID).
  const godPayloadPredatorIds: number[] = [];
  for (const a of godActions) {
    const p = a.payload as Record<string, unknown> | null;
    if (typeof p?.predatorId === "number") godPayloadPredatorIds.push(p.predatorId);
    if (typeof p?.targetPredatorId === "number") godPayloadPredatorIds.push(p.targetPredatorId);
  }
  if (godPayloadPredatorIds.length > 0) {
    const godPredators = await db.select().from(predators).where(inArray(predators.id, godPayloadPredatorIds));
    for (const p of godPredators) state.predators.set(p.id, p);
  }

  // Preload god actors for divine intervention actions (DIV_* types with actorId = godId).
  // Gated by GOD_ACTION_TYPES so these rows are guaranteed to be god-initiated.
  const godActorIds = Array.from(new Set(godActions.map(a => a.actorId).filter(id => id > 0)));
  if (godActorIds.length > 0) {
    const godRows = await db.select().from(gods).where(inArray(gods.id, godActorIds));
    for (const g of godRows) state.gods.set(g.id, g);
  }

  // ── Inhale Section A: Instance + lair-resident entity preload ──────────────
  // Collect instance IDs from (a) god action payloads and (b) actor frogs already in state.
  const instanceIdsToLoad = new Set<number>();
  for (const a of godActions) {
    const p = a.payload as Record<string, unknown> | null;
    if (typeof p?.instanceId === "number") instanceIdsToLoad.add(p.instanceId);
  }
  Array.from(state.frogs.values()).forEach(f => {
    if (f.instanceId != null) instanceIdsToLoad.add(f.instanceId);
  });

  if (instanceIdsToLoad.size > 0) {
    const instanceIdArr = Array.from(instanceIdsToLoad);
    const instanceRows = await getInstancesByIds(instanceIdArr);
    for (const inst of instanceRows) state.instances.set(inst.id, inst);

    for (const iid of instanceIdArr) {
      const [instFrogs, instPredators, instItems, instEntrances] = await Promise.all([
        getFrogsByInstanceId(iid),
        getPredatorsByInstanceId(iid),
        getItemsByInstanceId(iid),
        getLairEntrancesByInstanceId(iid),
      ]);
      for (const f of instFrogs) state.frogs.set(f.id, f);
      for (const p of instPredators) state.predators.set(p.id, p);
      for (const i of instItems) state.items.set(i.itemId, i);
      for (const e of instEntrances) state.lairEntrances.set(e.id, e);
    }
  }

  // ── Inhale Section B: Lair entrance preload for OPEN_DOOR ─────────────────
  // Load lair_entrances matching any overworld frog's current position so OPEN_DOOR
  // validate can check whether a frog is standing on a door tile.
  const overworldFrogPositions = Array.from(state.frogs.values())
    .filter(f => f.instanceId == null && !f.isDead)
    .map(f => ({ gridX: f.gridX, gridY: f.gridY }));

  if (overworldFrogPositions.length > 0) {
    const entrances = await getLairEntrancesByGridPositions(overworldFrogPositions);
    for (const e of entrances) state.lairEntrances.set(e.id, e);

    // Ensure each referenced instance is loaded (needed by OPEN_DOOR to read layout).
    const entranceInstanceIds = Array.from(new Set(entrances.map(e => e.instanceId)));
    for (const iid of entranceInstanceIds) {
      if (!state.instances.has(iid)) {
        const inst = await getInstanceById(iid);
        if (inst) state.instances.set(inst.id, inst);
      }
    }
  }

  // ── Inhale Section C: DIV_PLACE_LAIR entrance preload ────────────────────
  // Load ALL existing entrances for any god that is about to place a new one,
  // so validate() can determine if this is the first entrance (free) or a repeat (50 favor).
  const placeLairGodIdArr: number[] = [];
  for (const a of godActions) {
    if (a.actionType === "DIV_PLACE_LAIR") {
      const p = a.payload as Record<string, unknown> | null;
      if (typeof p?.godId === "number" && !placeLairGodIdArr.includes(p.godId)) {
        placeLairGodIdArr.push(p.godId);
      }
    }
  }
  for (const godId of placeLairGodIdArr) {
    const godEntrances = await getLairEntrancesByOwnerGodId(godId);
    for (const e of godEntrances) state.lairEntrances.set(e.id, e);
  }

  // 3. Predator AI Injection
  // (Left as a placeholder for the explicit AI tick integration later)

  // 4. Sequential Sorting
  // Pre-compute initiative scores once to avoid redundant state lookups inside the comparator.
  const initiativeMap = new Map<number, number>();
  for (const a of allPending) {
    if (a.actorId && !initiativeMap.has(a.actorId)) {
      const frog = state.getFrog(a.actorId);
      if (frog) { initiativeMap.set(a.actorId, frog.statsJson.dex ?? 0); continue; }
      const pred = state.getPredator(a.actorId);
      if (pred) initiativeMap.set(a.actorId, pred.statsJson?.speed ?? 0);
    }
  }

  allPending.sort((a, b) => {
    const aIsGod = !!GOD_ACTION_REGISTRY[a.actionType];
    const bIsGod = !!GOD_ACTION_REGISTRY[b.actionType];
    if (aIsGod && !bIsGod) return -1;
    if (!aIsGod && bIsGod) return 1;
    return (initiativeMap.get(b.actorId) ?? 0) - (initiativeMap.get(a.actorId) ?? 0);
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
          const fumbleMsg = validation.message ?? `${frog.name} fumbled!`;
          notify(frog.ownerId!, { type: "FUMBLE", message: fumbleMsg });
          pushActionLog({
            text:     fumbleMsg,
            x:        frog.gridX,
            y:        frog.gridY,
            chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
            category: "combat",
          });
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
    const godUpdates = new Map<number, Partial<typeof gods.$inferInsert>>();
    const instanceUpdates = new Map<number, Partial<typeof instances.$inferInsert>>();
    const itemsToInsert: (typeof items.$inferInsert)[] = [];
    const godsToInsert: (typeof gods.$inferInsert)[] = [];
    const predatorsToInsert: (typeof predators.$inferInsert)[] = [];
    const predatorsToDelete = new Set<number>();
    const actionsToInsert: (typeof pendingActions.$inferInsert)[] = [];
    const logsToInsert: (typeof worldLogEvents.$inferInsert)[] = [];
    const instancesToInsert: (typeof instances.$inferInsert)[] = [];
    const lairEntrancesToInsert: (typeof lairEntrances.$inferInsert)[] = [];
    const overridesToInsert: (typeof worldMapOverrides.$inferInsert)[] = [];
    const resolvedActions = new Set<number>();
    const cancelledActions = new Set<number>();

    for (const inst of updateQueue) {
      if (inst.type === "FROG_UPDATE") {
        const id = inst.id as number;
        frogUpdates.set(id, { ...frogUpdates.get(id), ...inst.changes });
      } else if (inst.type === "GOD_UPDATE") {
        const id = inst.id as number;
        godUpdates.set(id, { ...godUpdates.get(id), ...inst.changes });
      } else if (inst.type === "PREDATOR_UPDATE") {
        const id = inst.id as number;
        predatorUpdates.set(id, { ...predatorUpdates.get(id), ...inst.changes });
      } else if (inst.type === "ITEM_UPDATE") {
        const id = inst.id as string;
        itemUpdates.set(id, { ...itemUpdates.get(id), ...inst.changes });
      } else if (inst.type === "INSTANCE_UPDATE") {
        const id = inst.id as number;
        instanceUpdates.set(id, { ...instanceUpdates.get(id), ...inst.changes });
      } else if (inst.type === "ITEM_INSERT") {
        itemsToInsert.push(inst.data);
      } else if (inst.type === "GOD_INSERT") {
        godsToInsert.push(inst.data);
      } else if (inst.type === "PREDATOR_INSERT") {
        predatorsToInsert.push(inst.data);
      } else if (inst.type === "PREDATOR_DELETE") {
        predatorsToDelete.add(inst.id as number);
      } else if (inst.type === "ACTION_INSERT") {
        actionsToInsert.push(inst.data);
      } else if (inst.type === "WORLD_LOG_INSERT") {
        logsToInsert.push(inst.data);
      } else if (inst.type === "INSTANCE_INSERT") {
        instancesToInsert.push(inst.data);
      } else if (inst.type === "LAIR_ENTRANCE_INSERT") {
        lairEntrancesToInsert.push(inst.data);
      } else if (inst.type === "WORLD_MAP_OVERRIDE_INSERT") {
        overridesToInsert.push(inst.data);
      } else if (inst.type === "ACTION_RESOLVE") {
        resolvedActions.add(inst.id as number);
      } else if (inst.type === "ACTION_CANCEL") {
        cancelledActions.add(inst.id as number);
      }
    }

    // Execute bulk statements
    for (const [id, changes] of Array.from(frogUpdates.entries())) {
      await tx.update(frogs).set(changes).where(eq(frogs.id, id));
    }
    for (const [id, changes] of Array.from(predatorUpdates.entries())) {
      await tx.update(predators).set(changes).where(eq(predators.id, id));
    }
    for (const [id, changes] of Array.from(itemUpdates.entries())) {
      await tx.update(items).set(changes).where(eq(items.itemId, id));
    }
    if (itemsToInsert.length > 0) {
      await tx.insert(items).values(itemsToInsert);
    }
    if (godsToInsert.length > 0) {
      await tx.insert(gods).values(godsToInsert);
    }
    for (const [id, changes] of Array.from(godUpdates.entries())) {
      await tx.update(gods).set(changes).where(eq(gods.id, id));
    }
    if (predatorsToInsert.length > 0) {
      await tx.insert(predators).values(predatorsToInsert);
    }
    for (const id of Array.from(predatorsToDelete)) {
      await tx.delete(predators).where(eq(predators.id, id));
    }
    if (actionsToInsert.length > 0) {
      await tx.insert(pendingActions).values(actionsToInsert);
    }
    if (logsToInsert.length > 0) {
      await tx.insert(worldLogEvents).values(logsToInsert);
    }
    for (const [id, changes] of Array.from(instanceUpdates.entries())) {
      await tx.update(instances).set(changes).where(eq(instances.id, id));
    }
    if (instancesToInsert.length > 0) {
      await tx.insert(instances).values(instancesToInsert);
    }
    if (lairEntrancesToInsert.length > 0) {
      await tx.insert(lairEntrances).values(lairEntrancesToInsert).onConflictDoNothing();
    }
    if (overridesToInsert.length > 0) {
      await tx.insert(worldMapOverrides).values(overridesToInsert);
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
