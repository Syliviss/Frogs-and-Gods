import { EventEmitter } from "events";
import { ActionQueue, type EnqueuedAction, type EnqueueResult } from "./actionQueue";

type HeartbeatPhase = "idle" | "lock_in" | "resolution" | "broadcast";

export class HeartbeatEngine extends EventEmitter {
  private phase: HeartbeatPhase = "idle";
  private currentBucketId = 0;
  private subtickInterval: ReturnType<typeof setInterval> | null = null;
  private mainTickTimeout: ReturnType<typeof setTimeout> | null = null;
  readonly queue: ActionQueue;

  constructor() {
    super();
    this.queue = new ActionQueue();
  }

  start(): void {
    if (this.phase !== "idle") return;
    this.phase = "lock_in";
    this._startTimers();
  }

  stop(): void {
    this._clearTimers();
    this.phase = "idle";
    this.currentBucketId = 0;
  }

  enqueue(raw: { type: string; payload: unknown }): EnqueueResult {
    return this.queue.enqueue(raw, this.currentBucketId);
  }

  getCurrentBucketId(): number {
    return this.currentBucketId;
  }

  getPhase(): HeartbeatPhase {
    return this.phase;
  }

  private _startTimers(): void {
    this.subtickInterval = setInterval(() => {
      this.currentBucketId = (this.currentBucketId + 1) % 20;
      this.emit("subtick", this.currentBucketId);
    }, 500);

    this.mainTickTimeout = setTimeout(() => {
      this._runMainTick();
    }, 10_000);
  }

  private _clearTimers(): void {
    if (this.subtickInterval !== null) {
      clearInterval(this.subtickInterval);
      this.subtickInterval = null;
    }
    if (this.mainTickTimeout !== null) {
      clearTimeout(this.mainTickTimeout);
      this.mainTickTimeout = null;
    }
  }

  private _runMainTick(): void {
    this.phase = "resolution";
    this.queue.lock();
    const drained = this.queue.drainAll();

    console.log("[HeartbeatEngine] resolution tick — bucket counts:");
    for (const [bucketId, actions] of Array.from(drained)) {
      console.log(`  bucket ${bucketId}: ${actions.length} action(s)`);
    }

    this.emit("resolution", drained);

    this.phase = "broadcast";
    this.emit("broadcast", drained);

    this.queue.unlock();
    this.currentBucketId = 0;
    this._clearTimers();
    this.phase = "lock_in";
    this._startTimers();
  }
}

export type { EnqueuedAction, EnqueueResult };

export const heartbeat = new HeartbeatEngine();
