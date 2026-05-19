import type { Frog, Predator, Item, WorldMapChunk, InsertWorldLogEvent, God, Instance, LairEntrance } from "../../drizzle/schema";

export interface UpdateInstruction {
  type:
    | "FROG_UPDATE"
    | "FROG_INSERT"
    | "PREDATOR_UPDATE"
    | "ITEM_UPDATE"
    | "WORLD_LOG_INSERT"
    | "ACTION_RESOLVE"
    | "ACTION_CANCEL"
    | "ITEM_INSERT"
    | "PREDATOR_INSERT"
    | "PREDATOR_DELETE"
    | "ACTION_INSERT"
    | "GOD_INSERT"
    | "GOD_UPDATE"
    | "INSTANCE_INSERT"
    | "INSTANCE_UPDATE"
    | "LAIR_ENTRANCE_INSERT"
    | "WORLD_MAP_OVERRIDE_INSERT";
  id?: number | string;
  changes?: Record<string, any>;
  data?: any;
}

export class SimulatedState {
  public frogs        = new Map<number, Frog>();
  public predators    = new Map<number, Predator>();
  public items        = new Map<string, Item>();
  public chunks       = new Map<string, WorldMapChunk>();
  public gods         = new Map<number, God>();
  public instances    = new Map<number, Instance>();
  public lairEntrances = new Map<number, LairEntrance>();

  // ── Frogs ──
  getFrog(id: number): Frog | undefined {
    return this.frogs.get(id);
  }

  updateFrog(id: number, changes: Partial<Frog>) {
    const f = this.frogs.get(id);
    if (f) Object.assign(f, changes);
  }

  // ── Predators ──
  getPredator(id: number): Predator | undefined {
    return this.predators.get(id);
  }

  updatePredator(id: number, changes: Partial<Predator>) {
    const p = this.predators.get(id);
    if (p) Object.assign(p, changes);
  }

  // ── Items ──
  getItem(id: string): Item | undefined {
    return this.items.get(id);
  }

  updateItem(id: string, changes: Partial<Item>) {
    const i = this.items.get(id);
    if (i) Object.assign(i, changes);
  }

  // ── Gods ──
  getGod(id: number): God | undefined {
    return this.gods.get(id);
  }

  updateGod(id: number, changes: Partial<God>) {
    const g = this.gods.get(id);
    if (g) Object.assign(g, changes);
  }

  // ── Instances ──
  getInstance(id: number): Instance | undefined {
    return this.instances.get(id);
  }

  updateInstance(id: number, changes: Partial<Instance>) {
    const inst = this.instances.get(id);
    if (inst) Object.assign(inst, changes);
  }

  // ── Spatial Queries (In-Memory) ──
  // Default instanceId=null means "overworld". Passing a number scopes to that lair.
  getFrogsAt(gridX: number, gridY: number, instanceId: number | null = null): Frog[] {
    return Array.from(this.frogs.values()).filter(
      f => f.gridX === gridX && f.gridY === gridY && !f.isDead && (f.instanceId ?? null) === instanceId
    );
  }

  getPredatorsAt(gridX: number, gridY: number, instanceId: number | null = null): Predator[] {
    return Array.from(this.predators.values()).filter(
      p => p.gridX === gridX && p.gridY === gridY && p.currentHp > 0 && (p.instanceId ?? null) === instanceId
    );
  }

  getItemsAt(gridX: number, gridY: number, instanceId: number | null = null): Item[] {
    return Array.from(this.items.values()).filter(
      i => i.gridX === gridX && i.gridY === gridY && i.itemState === "GROUND" && (i.instanceId ?? null) === instanceId
    );
  }

  // ── Lair Helpers ──

  getLairEntranceAt(gridX: number, gridY: number): LairEntrance | undefined {
    return Array.from(this.lairEntrances.values()).find(
      e => e.gridX === gridX && e.gridY === gridY
    );
  }

  getLairEntrancesForInstance(instanceId: number): LairEntrance[] {
    return Array.from(this.lairEntrances.values()).filter(e => e.instanceId === instanceId);
  }

  getInstanceTileAt(instanceId: number, localX: number, localY: number): string | null {
    const inst = this.instances.get(instanceId);
    if (!inst || !inst.tileDataJson) return null;
    try {
      const grid: string[][] = JSON.parse(inst.tileDataJson);
      return grid[localY]?.[localX] ?? null;
    } catch {
      return null;
    }
  }
}
