import { pushActionLog } from "../engine/actionLog";
import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { applyDamage, checkItemFumble } from "./_utils";
import type {
  ActionContext,
  ActionHandler,
  ExecuteResult,
  NotifyFn,
  ValidationResult,
} from "./_types";
import type {
  PredatorActionContext,
  PredatorActionHandler,
  PredatorActionResult,
} from "./_predator_types";
import type {
  Frog,
  Item,
  Predator,
  PredatorStats,
  FlingProfile,
} from "../../drizzle/schema";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

// ─────────────────────────────────────────────
// BALANCE CONSTANTS — tweak these to rebalance FLING globally
// ─────────────────────────────────────────────

const FLING_BASE_DAMAGE     = 3;
const FLING_BASE_RANGE      = 8;
const STR_DAMAGE_DIVISOR    = 5;   // damage += floor(STR / 5)
const HIT_PCT_PER_DEX       = 5;   // hit% += 5 per DEX point
const HIT_PCT_DISTANCE_PEN  = 3;   // hit% -= 3 per tile of distance
const HIT_PCT_CAP           = 95;
const HIT_PCT_FLOOR         = 5;
const BREATH_PER_SPACE      = 1;

const EXPLODE_DAMAGE        = 3;
const POISON_DMG_PER_TICK   = 1;

// ─────────────────────────────────────────────
// Per-enemy-type predator FLING profiles. Empty for now — populated by
// future ranged-AI entity files (e.g. Gremlin). Snakes & golems never queue FLING.
// ─────────────────────────────────────────────

export const PREDATOR_FLING_PROFILES: Record<string, FlingProfile | undefined> = {};

const DEFAULT_PROFILE: FlingProfile = {
  baseDamage:     FLING_BASE_DAMAGE,
  maxRange:       FLING_BASE_RANGE,
  breathPerSpace: BREATH_PER_SPACE,
  hitCount:       1,
  multiHitMode:   "REROLL",
  consumeEffect:  "NONE",
};

// ─────────────────────────────────────────────
// Uniform actor abstraction. The pluggable formula functions read from this
// shape so the same math works for frog and predator actors.
// ─────────────────────────────────────────────

interface ActorView {
  kind:           "FROG" | "PREDATOR";
  id:             number;
  name:           string;
  gridX:          number;
  gridY:          number;
  instanceId:     number | null;
  str:            number;
  dex:            number;
  currentBreath:  number;
  bonuses: {
    damage:          number;
    hit:             number;
    range:           number;
    breathReduction: number;
    hitCount:        number;
  };
}

function asFrogActor(f: Frog): ActorView {
  const s = f.statsJson;
  return {
    kind:          "FROG",
    id:            f.id,
    name:          f.name,
    gridX:         f.gridX,
    gridY:         f.gridY,
    instanceId:    f.instanceId ?? null,
    str:           s.str + (s.equippedStrBonus ?? 0),
    dex:           s.dex + (s.equippedDexBonus ?? 0),
    currentBreath: f.currentBreath,
    bonuses: {
      damage:          s.equippedRangedDamageBonus     ?? 0,
      hit:             s.equippedRangedHitBonus        ?? 0,
      range:           s.equippedRangedRangeBonus      ?? 0,
      breathReduction: s.equippedRangedBreathReduction ?? 0,
      hitCount:        s.equippedRangedHitCount        ?? 0,
    },
  };
}

function asPredatorActor(p: Predator): ActorView {
  const s = (p.statsJson ?? {}) as PredatorStats;
  return {
    kind:          "PREDATOR",
    id:            p.id,
    name:          p.enemyType,
    gridX:         p.gridX,
    gridY:         p.gridY,
    instanceId:    p.instanceId ?? null,
    // Predators don't have str/dex columns today — read from statsJson with safe defaults.
    str:           (s.str as number | undefined) ?? 10,
    dex:           (s.dex as number | undefined) ?? 10,
    currentBreath: p.currentBreath,
    bonuses: {
      damage:          s.equippedRangedDamageBonus     ?? 0,
      hit:             s.equippedRangedHitBonus        ?? 0,
      range:           s.equippedRangedRangeBonus      ?? 0,
      breathReduction: s.equippedRangedBreathReduction ?? 0,
      hitCount:        s.equippedRangedHitCount        ?? 0,
    },
  };
}

// ─────────────────────────────────────────────
// PLUGGABLE FORMULAS — swap function bodies to rebalance
// ─────────────────────────────────────────────

function damage(actor: ActorView, profile: FlingProfile): number {
  return profile.baseDamage
    + Math.floor(actor.str / STR_DAMAGE_DIVISOR)
    + actor.bonuses.damage;
}

function hitChance(actor: ActorView, _profile: FlingProfile, dist: number): number {
  const raw = actor.dex * HIT_PCT_PER_DEX
            - dist * HIT_PCT_DISTANCE_PEN
            + actor.bonuses.hit;
  return Math.max(HIT_PCT_FLOOR, Math.min(HIT_PCT_CAP, raw));
}

function breathCost(actor: ActorView, profile: FlingProfile, dist: number): number {
  const raw = dist * profile.breathPerSpace - actor.bonuses.breathReduction;
  return Math.max(1, raw);
}

function hitCount(actor: ActorView, profile: FlingProfile): number {
  return Math.max(1, profile.hitCount + actor.bonuses.hitCount);
}

function rangeOf(actor: ActorView, profile: FlingProfile): number {
  return Math.max(1, profile.maxRange + actor.bonuses.range);
}

// ─────────────────────────────────────────────
// Target finding
// ─────────────────────────────────────────────

interface TargetCandidate {
  kind:  "FROG" | "PREDATOR";
  id:    number;
  name:  string;
  gridX: number;
  gridY: number;
  dist:  number;
}

function listFlingTargets(state: SimulatedState, actor: ActorView, maxRange: number): TargetCandidate[] {
  const out: TargetCandidate[] = [];

  for (const f of Array.from(state.frogs.values())) {
    if (f.isDead) continue;
    if ((f.instanceId ?? null) !== actor.instanceId) continue;
    if (actor.kind === "FROG" && f.id === actor.id) continue; // no self-hit
    const d = chebyshevDistance(actor.gridX, actor.gridY, f.gridX, f.gridY);
    if (d > maxRange) continue;
    out.push({ kind: "FROG", id: f.id, name: f.name, gridX: f.gridX, gridY: f.gridY, dist: d });
  }

  // Predators only target frogs; frogs may target predators too.
  if (actor.kind === "FROG") {
    for (const p of Array.from(state.predators.values())) {
      if (p.currentHp <= 0) continue;
      if ((p.instanceId ?? null) !== actor.instanceId) continue;
      const d = chebyshevDistance(actor.gridX, actor.gridY, p.gridX, p.gridY);
      if (d > maxRange) continue;
      out.push({ kind: "PREDATOR", id: p.id, name: p.enemyType, gridX: p.gridX, gridY: p.gridY, dist: d });
    }
  }

  // Sort by distance ascending, deterministic ties via id.
  out.sort((a, b) => a.dist - b.dist || a.id - b.id);
  return out;
}

function findNearestFlingTarget(state: SimulatedState, actor: ActorView, maxRange: number): TargetCandidate | null {
  return listFlingTargets(state, actor, maxRange)[0] ?? null;
}

// ─────────────────────────────────────────────
// Roll resolution
// ─────────────────────────────────────────────

interface HitEntry {
  kind:   "FROG" | "PREDATOR";
  id:     number;
  name:   string;
  damage: number;
  newHp:  number;
  tileX:  number;
  tileY:  number;
}

interface MissEntry {
  kind:  "FROG" | "PREDATOR";
  id:    number;
  name:  string;
  tileX: number;
  tileY: number;
}

function resolveTarget(
  state:   SimulatedState,
  out:     UpdateInstruction[],
  actor:   ActorView,
  profile: FlingProfile,
  target:  TargetCandidate,
  rolls:   number,
  hits:    HitEntry[],
  misses:  MissEntry[],
): void {
  const dmg = damage(actor, profile);
  const pct = hitChance(actor, profile, target.dist);
  for (let i = 0; i < rolls; i++) {
    const roll = Math.random() * 100;
    if (roll <= pct) {
      const previousHp = target.kind === "FROG"
        ? state.getFrog(target.id)?.currentHp ?? 0
        : state.getPredator(target.id)?.currentHp ?? 0;
      applyDamage(state, out, target.kind, target.id, dmg);
      hits.push({
        kind:   target.kind,
        id:     target.id,
        name:   target.name,
        damage: dmg,
        newHp:  Math.max(0, previousHp - dmg),
        tileX:  target.gridX,
        tileY:  target.gridY,
      });
    } else {
      misses.push({ kind: target.kind, id: target.id, name: target.name, tileX: target.gridX, tileY: target.gridY });
    }
  }
}

// ─────────────────────────────────────────────
// Consume-effect dispatch (only triggers for FLING_CONSUME)
// ─────────────────────────────────────────────

function applyConsumeEffect(
  state:   SimulatedState,
  out:     UpdateInstruction[],
  actor:   ActorView,
  effect:  FlingProfile["consumeEffect"],
  impactX: number,
  impactY: number,
  primaryTarget: TargetCandidate | null,
  itemId:  string | null,
): void {
  switch (effect) {
    case "NONE":
      return;

    case "EXPLODE": {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const tx = impactX + dx;
          const ty = impactY + dy;
          for (const f of state.getFrogsAt(tx, ty, actor.instanceId)) {
            if (actor.kind === "FROG" && f.id === actor.id) continue;
            applyDamage(state, out, "FROG", f.id, EXPLODE_DAMAGE);
            pushActionLog({
              text:     `${f.name} is caught in the blast! (-${EXPLODE_DAMAGE} HP)`,
              x:        tx, y: ty,
              chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
              category: "combat",
            });
          }
          for (const p of state.getPredatorsAt(tx, ty, actor.instanceId)) {
            applyDamage(state, out, "PREDATOR", p.id, EXPLODE_DAMAGE);
            pushActionLog({
              text:     `${p.enemyType} is caught in the blast! (-${EXPLODE_DAMAGE} HP)`,
              x:        tx, y: ty,
              chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
              category: "combat",
            });
          }
        }
      }
      return;
    }

    case "POISON": {
      if (!primaryTarget || primaryTarget.kind !== "FROG") return;
      const f = state.getFrog(primaryTarget.id);
      if (!f || f.isDead) return;
      const newStats = { ...f.statsJson, poison: { dmgPerTick: POISON_DMG_PER_TICK } };
      state.updateFrog(f.id, { statsJson: newStats });
      out.push({ type: "FROG_UPDATE", id: f.id, changes: { statsJson: newStats } });
      return;
    }

    case "WRAPPED": {
      if (!primaryTarget || primaryTarget.kind !== "FROG" || !itemId) return;
      const f = state.getFrog(primaryTarget.id);
      if (!f || f.isDead) return;
      const newStats = { ...f.statsJson, wrappedByItem: itemId };
      state.updateFrog(f.id, { statsJson: newStats });
      out.push({ type: "FROG_UPDATE", id: f.id, changes: { statsJson: newStats } });
      return;
    }
  }
}

// ─────────────────────────────────────────────
// Shared core resolution (used by frog & predator handlers)
// ─────────────────────────────────────────────

interface CoreResolution {
  hits:           HitEntry[];
  misses:         MissEntry[];
  primaryTarget:  TargetCandidate;
  newBreath:      number;
  impactX:        number;
  impactY:        number;
}

function resolveFling(
  state:   SimulatedState,
  out:     UpdateInstruction[],
  actor:   ActorView,
  profile: FlingProfile,
): CoreResolution | { error: string } {
  const range = rangeOf(actor, profile);
  const targets = listFlingTargets(state, actor, range);
  if (targets.length === 0) return { error: "No valid target in range." };

  const primary = targets[0]!;
  const cost = breathCost(actor, profile, primary.dist);
  if (cost > actor.currentBreath) {
    return { error: `Not enough breath (need ${cost}, have ${actor.currentBreath}).` };
  }

  const rolls = hitCount(actor, profile);
  const hits:   HitEntry[]  = [];
  const misses: MissEntry[] = [];

  if (profile.multiHitMode === "SCATTER") {
    const slice = targets.slice(0, rolls);
    for (const t of slice) resolveTarget(state, out, actor, profile, t, 1, hits, misses);
  } else {
    // REROLL — N rolls on the nearest target
    resolveTarget(state, out, actor, profile, primary, rolls, hits, misses);
  }

  return {
    hits, misses,
    primaryTarget: primary,
    newBreath:     actor.currentBreath - cost,
    impactX:       primary.gridX,
    impactY:       primary.gridY,
  };
}

// ─────────────────────────────────────────────
// FROG HANDLER (ACTION_REGISTRY — both "FLING" and "FLING_CONSUME" point here)
// ─────────────────────────────────────────────

export const flingHandler: ActionHandler = {
  validate(ctx: ActionContext, state: SimulatedState): ValidationResult {
    const frog = ctx.frog!;
    const itemId = ctx.payload.itemId as string | undefined;
    if (!itemId) return { ok: false, message: "itemId required in payload." };

    const item = state.getItem(itemId);
    if (!item) return { ok: false, message: "Item not found." };
    if (item.itemState !== "EQUIPPED" || item.ownerId !== frog.id) {
      return { ok: false, message: "Item must be equipped by this frog." };
    }

    const grants = item.statsJson?.grantedActions ?? [];
    if (!grants.includes(ctx.actionType)) {
      return { ok: false, message: `Item does not grant ${ctx.actionType}.` };
    }

    const fumble = checkItemFumble(frog.id, ctx.actionType, state);
    if (fumble) return fumble;

    const actor   = asFrogActor(frog);
    const profile = item.statsJson?.flingProfile ?? DEFAULT_PROFILE;
    const range   = rangeOf(actor, profile);
    const nearest = findNearestFlingTarget(state, actor, range);
    if (!nearest) return { ok: false, message: "No target in range to fling at." };

    const cost = breathCost(actor, profile, nearest.dist);
    if (cost > frog.currentBreath) {
      return { ok: false, message: `Not enough breath (need ${cost}, have ${frog.currentBreath}).` };
    }

    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog    = ctx.frog!;
    const itemId  = ctx.payload.itemId as string;
    const item    = state.getItem(itemId)!;
    const profile = item.statsJson?.flingProfile ?? DEFAULT_PROFILE;
    const actor   = asFrogActor(frog);
    const consume = ctx.actionType === "FLING_CONSUME";

    const res = resolveFling(state, out, actor, profile);
    if ("error" in res) {
      return { success: false, data: { itemId, itemName: item.name, error: res.error, consumed: false } };
    }

    // Deduct breath (full cost regardless of hit/miss)
    state.updateFrog(frog.id, { currentBreath: res.newBreath });
    out.push({ type: "FROG_UPDATE", id: frog.id, changes: { currentBreath: res.newBreath } });

    if (consume) {
      // Item destroyed — set to VOID with no owner/position
      state.updateItem(itemId, { itemState: "VOID", ownerId: null, gridX: null, gridY: null, parentContainerId: null });
      out.push({ type: "ITEM_UPDATE", id: itemId, changes: { itemState: "VOID", ownerId: null, gridX: null, gridY: null, parentContainerId: null } });
      applyConsumeEffect(state, out, actor, profile.consumeEffect, res.impactX, res.impactY, res.primaryTarget, itemId);
    }

    return {
      success: true,
      data: {
        itemId,
        itemName:    item.name,
        hits:        res.hits,
        misses:      res.misses,
        consumed:    consume,
        consumeEffect: consume ? profile.consumeEffect : "NONE",
        actorGridX:  frog.gridX,
        actorGridY:  frog.gridY,
        targetGridX: res.impactX,
        targetGridY: res.impactY,
        newBreath:   res.newBreath,
      },
    };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): void {
    const frog = ctx.frog!;
    const d    = result.data as {
      itemId: string; itemName: string;
      hits?: HitEntry[]; misses?: MissEntry[];
      consumed?: boolean; consumeEffect?: FlingProfile["consumeEffect"];
      actorGridX?: number; actorGridY?: number;
      targetGridX?: number; targetGridY?: number;
      newBreath?: number;
      error?: string;
    };

    if (!result.success || d.error) {
      pushActionLog({
        text:     `${frog.name} tries to fling ${d.itemName} — ${d.error ?? "fails"}.`,
        x:        frog.gridX,
        y:        frog.gridY,
        chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });
      if (frog.ownerId != null) notify(frog.ownerId, { type: "FLING_FAILED", reason: d.error });
      return;
    }

    const hits   = d.hits   ?? [];
    const misses = d.misses ?? [];

    for (const h of hits) {
      pushActionLog({
        text:     `${frog.name} flings ${d.itemName} at ${h.name} for ${h.damage} dmg (HP: ${h.newHp})`,
        x:        h.tileX, y: h.tileY,
        chunk_id: `${Math.floor(h.tileX / CHUNK_SIZE)}:${Math.floor(h.tileY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }
    for (const m of misses) {
      pushActionLog({
        text:     `${frog.name} flings ${d.itemName} at ${m.name} — Miss!`,
        x:        m.tileX, y: m.tileY,
        chunk_id: `${Math.floor(m.tileX / CHUNK_SIZE)}:${Math.floor(m.tileY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }

    if (frog.ownerId != null) {
      notify(frog.ownerId, {
        type:        "FLING_RESOLVED",
        itemId:      d.itemId,
        itemName:    d.itemName,
        consumed:    d.consumed,
        consumeEffect: d.consumeEffect,
        hits, misses,
        actorGridX:  d.actorGridX,
        actorGridY:  d.actorGridY,
        targetGridX: d.targetGridX,
        targetGridY: d.targetGridY,
        newBreath:   d.newBreath,
      });
    }
  },
};

// ─────────────────────────────────────────────
// PREDATOR HANDLER (PREDATOR_ACTION_REGISTRY)
// AI queues FLING directly; per-enemy-type profile drives the math.
// ─────────────────────────────────────────────

export const flingPredatorHandler: PredatorActionHandler = {
  validate(_ctx: PredatorActionContext, predator: Predator, state: SimulatedState): PredatorActionResult {
    const profile = PREDATOR_FLING_PROFILES[predator.enemyType] ?? DEFAULT_PROFILE;
    const actor   = asPredatorActor(predator);
    const range   = rangeOf(actor, profile);
    const nearest = findNearestFlingTarget(state, actor, range);
    if (!nearest) return { success: false, error: "No target in range." };
    const cost = breathCost(actor, profile, nearest.dist);
    if (cost > predator.currentBreath) {
      return { success: false, error: `Not enough breath (need ${cost}, have ${predator.currentBreath}).` };
    }
    return { success: true };
  },

  execute(_ctx: PredatorActionContext, predator: Predator, state: SimulatedState, out: UpdateInstruction[]): PredatorActionResult {
    const profile = PREDATOR_FLING_PROFILES[predator.enemyType] ?? DEFAULT_PROFILE;
    const actor   = asPredatorActor(predator);

    const res = resolveFling(state, out, actor, profile);
    if ("error" in res) return { success: false, fumble: true, error: res.error };

    state.updatePredator(predator.id, { currentBreath: res.newBreath });
    out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: { currentBreath: res.newBreath } });

    // Predators have no item to destroy, but the profile's consumeEffect still fires.
    applyConsumeEffect(state, out, actor, profile.consumeEffect, res.impactX, res.impactY, res.primaryTarget, null);

    return {
      success: true,
      data: {
        hits:        res.hits,
        misses:      res.misses,
        actorGridX:  predator.gridX,
        actorGridY:  predator.gridY,
        targetGridX: res.impactX,
        targetGridY: res.impactY,
        newBreath:   res.newBreath,
        consumeEffect: profile.consumeEffect,
      },
    };
  },

  broadcast(_ctx: PredatorActionContext, predator: Predator, result: PredatorActionResult, notify: NotifyFn): void {
    if (!result.success) {
      pushActionLog({
        text:     `${predator.enemyType} fling: ${result.error ?? "fails"}`,
        x:        predator.gridX, y: predator.gridY,
        chunk_id: `${Math.floor(predator.gridX / CHUNK_SIZE)}:${Math.floor(predator.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });
      return;
    }
    const d = result.data as {
      hits:   HitEntry[];
      misses: MissEntry[];
      actorGridX: number; actorGridY: number;
      targetGridX: number; targetGridY: number;
      consumeEffect: FlingProfile["consumeEffect"];
    };

    for (const h of d.hits) {
      pushActionLog({
        text:     `${predator.enemyType} flings at ${h.name} for ${h.damage} dmg (HP: ${h.newHp})`,
        x:        h.tileX, y: h.tileY,
        chunk_id: `${Math.floor(h.tileX / CHUNK_SIZE)}:${Math.floor(h.tileY / CHUNK_SIZE)}`,
        category: "combat",
      });
      if (h.kind === "FROG") notify(h.id, { type: "FLING_HIT", damage: h.damage, newHp: h.newHp, fromPredatorId: predator.id });
    }
    for (const m of d.misses) {
      pushActionLog({
        text:     `${predator.enemyType} flings at ${m.name} — Miss!`,
        x:        m.tileX, y: m.tileY,
        chunk_id: `${Math.floor(m.tileX / CHUNK_SIZE)}:${Math.floor(m.tileY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }
  },
};
