import { PendingActionSchema } from "../../shared/game.schema";

export interface EnqueuedAction {
  id: string;
  type: string;
  payload: unknown;
  bucketId: number;
  enqueuedAt: number;
}

export type EnqueueResult =
  | { ok: true; action: EnqueuedAction }
  | { ok: false; error: string };

export class ActionQueue {
  private buckets: Map<number, EnqueuedAction[]> = new Map();
  private isLocked = false;

  enqueue(raw: { type: string; payload: unknown }, bucketId: number): EnqueueResult {
    if (this.isLocked) {
      return { ok: false, error: "Queue is locked during resolution" };
    }

    if (!Number.isInteger(bucketId) || bucketId < 0 || bucketId > 19) {
      return { ok: false, error: "Invalid bucketId: must be integer 0–19" };
    }

    const parsed = PendingActionSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid action" };
    }

    const action: EnqueuedAction = {
      id: crypto.randomUUID(),
      type: parsed.data.type,
      payload: parsed.data.payload,
      bucketId,
      enqueuedAt: Date.now(),
    };

    if (!this.buckets.has(bucketId)) {
      this.buckets.set(bucketId, []);
    }
    this.buckets.get(bucketId)!.push(action);

    return { ok: true, action };
  }

  drainAll(): Map<number, EnqueuedAction[]> {
    const snapshot = new Map(this.buckets);
    this.buckets.clear();
    return snapshot;
  }

  lock(): void {
    this.isLocked = true;
  }

  unlock(): void {
    this.isLocked = false;
  }

  size(): number {
    let total = 0;
    for (const arr of Array.from(this.buckets.values())) total += arr.length;
    return total;
  }
}
