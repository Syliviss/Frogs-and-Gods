import type { Frog, Predator, Item, WorldMapChunk, InsertWorldLogEvent } from "../../drizzle/schema";

export interface UpdateInstruction {
  type: "FROG_UPDATE" | "PREDATOR_UPDATE" | "ITEM_UPDATE" | "WORLD_LOG_INSERT" | "ACTION_RESOLVE" | "ACTION_CANCEL" | "ITEM_INSERT" | "PREDATOR_INSERT" | "PREDATOR_DELETE" | "ACTION_INSERT";
  id?: number | string; // Entity ID for updates
  changes?: Record<string, any>; // Partial state changes
  data?: any; // Data for inserts
}

export class SimulatedState {
  public frogs = new Map<number, Frog>();
  public predators = new Map<number, Predator>();
  public items = new Map<string, Item>();
  public chunks = new Map<string, WorldMapChunk>();

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

  // ── Spatial Queries (In-Memory) ──
  getFrogsAt(gridX: number, gridY: number): Frog[] {
    return Array.from(this.frogs.values()).filter(f => f.gridX === gridX && f.gridY === gridY && !f.isDead);
  }

  getPredatorsAt(gridX: number, gridY: number): Predator[] {
    return Array.from(this.predators.values()).filter(p => p.gridX === gridX && p.gridY === gridY && p.currentHp > 0);
  }

  getItemsAt(gridX: number, gridY: number): Item[] {
    return Array.from(this.items.values()).filter(i => i.gridX === gridX && i.gridY === gridY && i.itemState === "GROUND");
  }
}
