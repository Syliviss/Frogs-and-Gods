import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HeartbeatEngine } from "./heartbeat";

describe("HeartbeatEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits subtick every 500ms", () => {
    const engine = new HeartbeatEngine();
    const subtickSpy = vi.fn();
    engine.on("subtick", subtickSpy);

    engine.start();
    vi.advanceTimersByTime(2000);

    expect(subtickSpy).toHaveBeenCalledTimes(4);
    engine.stop();
  });

  it("emits broadcast after 10s", () => {
    const engine = new HeartbeatEngine();
    const broadcastSpy = vi.fn();
    engine.on("broadcast", broadcastSpy);

    engine.start();
    vi.advanceTimersByTime(10_000);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it("does not emit broadcast before 10s", () => {
    const engine = new HeartbeatEngine();
    const broadcastSpy = vi.fn();
    engine.on("broadcast", broadcastSpy);

    engine.start();
    vi.advanceTimersByTime(9_999);

    expect(broadcastSpy).not.toHaveBeenCalled();
    engine.stop();
  });

  it("starts a new cycle after broadcast — subticks continue", () => {
    const engine = new HeartbeatEngine();
    const subtickSpy = vi.fn();
    engine.on("subtick", subtickSpy);

    engine.start();
    vi.advanceTimersByTime(10_000); // first cycle ends, broadcast fires, new cycle starts
    subtickSpy.mockClear();
    vi.advanceTimersByTime(1000); // 2 subticks into second cycle

    expect(subtickSpy).toHaveBeenCalledTimes(2);
    engine.stop();
  });

  it("stop() halts all timers", () => {
    const engine = new HeartbeatEngine();
    const subtickSpy = vi.fn();
    const broadcastSpy = vi.fn();
    engine.on("subtick", subtickSpy);
    engine.on("broadcast", broadcastSpy);

    engine.start();
    vi.advanceTimersByTime(1000);
    engine.stop();
    vi.advanceTimersByTime(20_000); // nothing should fire after stop

    expect(subtickSpy).toHaveBeenCalledTimes(2); // only the 2 before stop
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it("getPhase() reflects engine state", () => {
    const engine = new HeartbeatEngine();
    expect(engine.getPhase()).toBe("idle");

    engine.start();
    expect(engine.getPhase()).toBe("lock_in");

    vi.advanceTimersByTime(10_000);
    // after broadcast fires and new cycle starts, phase returns to lock_in
    expect(engine.getPhase()).toBe("lock_in");

    engine.stop();
    expect(engine.getPhase()).toBe("idle");
  });
});
