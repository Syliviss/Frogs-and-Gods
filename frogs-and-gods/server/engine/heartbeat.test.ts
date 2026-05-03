import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HeartbeatEngine } from "./heartbeat";

describe("HeartbeatEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("action at t=0 lands in bucket 0", () => {
    const engine = new HeartbeatEngine();
    engine.start();

    const result = engine.enqueue({ type: "MOVE", payload: { x: 1, y: 2 } });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action.bucketId).toBe(0);

    engine.stop();
  });

  it("action after 500ms lands in bucket 1", () => {
    const engine = new HeartbeatEngine();
    engine.start();
    vi.advanceTimersByTime(500);

    const result = engine.enqueue({ type: "ATTACK", payload: {} });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action.bucketId).toBe(1);

    engine.stop();
  });

  it("action at cumulative t=1200ms lands in bucket 2", () => {
    const engine = new HeartbeatEngine();
    engine.start();
    vi.advanceTimersByTime(1200); // subtick at 500ms (→1), at 1000ms (→2); at 1200ms bucket=2

    const result = engine.enqueue({ type: "DEFEND", payload: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action.bucketId).toBe(2);

    engine.stop();
  });

  it("all 20 buckets are correctly populated across the 10s window", () => {
    const engine = new HeartbeatEngine();
    engine.start();

    // Bucket 0: enqueue immediately
    engine.enqueue({ type: "ACTION", payload: { bucket: 0 } });

    // Buckets 1–19: advance 500ms then enqueue
    for (let bucket = 1; bucket <= 19; bucket++) {
      vi.advanceTimersByTime(500);
      engine.enqueue({ type: "ACTION", payload: { bucket } });
    }

    expect(engine.queue.size()).toBe(20);

    engine.queue.lock();
    const drained = engine.queue.drainAll();

    for (let i = 0; i <= 19; i++) {
      const bucket = drained.get(i);
      expect(bucket, `bucket ${i} should exist`).toBeDefined();
      expect(bucket!.length).toBe(1);
      expect(bucket![0].bucketId).toBe(i);
    }

    engine.stop();
  });

  it("queue is empty after main tick fires at t=10000ms", () => {
    const engine = new HeartbeatEngine();
    engine.start();

    engine.enqueue({ type: "A", payload: null });
    vi.advanceTimersByTime(500);
    engine.enqueue({ type: "B", payload: null });

    expect(engine.queue.size()).toBe(2);

    vi.advanceTimersByTime(9500); // total = 10000ms — main tick fires

    expect(engine.queue.size()).toBe(0);
    engine.stop();
  });

  it("enqueue during resolution phase returns ok:false", () => {
    const engine = new HeartbeatEngine();
    let resultDuringResolution: ReturnType<typeof engine.enqueue> | null = null;

    engine.on("resolution", () => {
      // queue is locked at this point — emit is synchronous inside _runMainTick
      resultDuringResolution = engine.enqueue({ type: "SNEAKY", payload: null });
    });

    engine.start();
    vi.advanceTimersByTime(10_000);

    expect(resultDuringResolution).not.toBeNull();
    expect(resultDuringResolution!.ok).toBe(false);

    engine.stop();
  });

  it("after resolution+broadcast, new cycle starts at bucket 0", () => {
    const engine = new HeartbeatEngine();
    engine.start();

    vi.advanceTimersByTime(10_000); // completes full cycle

    const result = engine.enqueue({ type: "NEW_CYCLE", payload: {} });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action.bucketId).toBe(0);

    engine.stop();
  });

  it("new cycle advances buckets correctly after 500ms", () => {
    const engine = new HeartbeatEngine();
    engine.start();

    vi.advanceTimersByTime(10_000); // complete cycle 1
    vi.advanceTimersByTime(500);    // 500ms into cycle 2

    const result = engine.enqueue({ type: "CYCLE_2_ACTION", payload: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action.bucketId).toBe(1);

    engine.stop();
  });
});
