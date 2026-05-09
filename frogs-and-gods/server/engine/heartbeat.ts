import { EventEmitter } from "events";

type HeartbeatPhase = "idle" | "lock_in" | "broadcast";

export class HeartbeatEngine extends EventEmitter {
  private phase: HeartbeatPhase = "idle";
  private subtickInterval: ReturnType<typeof setInterval> | null = null;
  private mainTickTimeout: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.phase !== "idle") return;
    this.phase = "lock_in";
    this._startTimers();
  }

  stop(): void {
    this._clearTimers();
    this.phase = "idle";
  }

  getPhase(): HeartbeatPhase {
    return this.phase;
  }

  private _startTimers(): void {
    this.subtickInterval = setInterval(() => {
      this.emit("subtick");
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
    this.phase = "broadcast";
    this.emit("broadcast");
    this._clearTimers();
    this.phase = "lock_in";
    this._startTimers();
    // Tick 0 of the new cycle: entity AI calculates intent and queues pending_actions
    this.emit("cycle_start");
  }
}

export const heartbeat = new HeartbeatEngine();
