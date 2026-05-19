import { describe, it, expect } from "vitest";
import {
  chebyshevDistance,
  getHopPath,
  getLineTiles,
  OPEN_WATER_TILES,
  SWIM_PASSABLE_TILES,
} from "./movement";

describe("chebyshevDistance", () => {
  it("returns max of dx/dy for orthogonal moves", () => {
    expect(chebyshevDistance(0, 0, 3, 0)).toBe(3);
    expect(chebyshevDistance(0, 0, 0, 2)).toBe(2);
  });

  it("returns max of dx/dy for diagonal moves", () => {
    expect(chebyshevDistance(0, 0, 3, 2)).toBe(3);
    expect(chebyshevDistance(0, 0, 2, 2)).toBe(2);
  });
});

describe("getHopPath", () => {
  it("returns straight horizontal path", () => {
    expect(getHopPath(0, 0, 3, 0)).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  });

  it("returns straight diagonal path", () => {
    expect(getHopPath(0, 0, 2, 2)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it("includes destination, excludes origin", () => {
    const path = getHopPath(5, 5, 6, 5);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ x: 6, y: 5 });
  });
});

describe("getLineTiles", () => {
  it("horizontal line", () => {
    expect(getLineTiles(0, 0, 3, 0)).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  });

  it("diagonal line", () => {
    expect(getLineTiles(0, 0, 2, 2)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it("arbitrary slope — (0,0) to (3,1) traverses intermediate tiles", () => {
    const path = getLineTiles(0, 0, 3, 1);
    expect(path[path.length - 1]).toEqual({ x: 3, y: 1 });
    expect(path.length).toBe(3);
  });

  it("excludes origin, includes destination", () => {
    const path = getLineTiles(5, 5, 6, 5);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual({ x: 6, y: 5 });
  });
});

describe("OPEN_WATER_TILES", () => {
  it("contains deep lake, river, and shore", () => {
    expect(OPEN_WATER_TILES.has("≈")).toBe(true);
    expect(OPEN_WATER_TILES.has("~")).toBe(true);
    expect(OPEN_WATER_TILES.has("+")).toBe(true);
  });

  it("does not contain lily pads or land", () => {
    expect(OPEN_WATER_TILES.has("@")).toBe(false);
    expect(OPEN_WATER_TILES.has("#")).toBe(false);
  });
});

describe("SWIM_PASSABLE_TILES", () => {
  it("contains open water, shore, and lily pads", () => {
    expect(SWIM_PASSABLE_TILES.has("≈")).toBe(true);
    expect(SWIM_PASSABLE_TILES.has("~")).toBe(true);
    expect(SWIM_PASSABLE_TILES.has("+")).toBe(true);
    expect(SWIM_PASSABLE_TILES.has("@")).toBe(true);
    expect(SWIM_PASSABLE_TILES.has("%")).toBe(true);
  });

  it("does not contain land or peaks", () => {
    expect(SWIM_PASSABLE_TILES.has("#")).toBe(false);
    expect(SWIM_PASSABLE_TILES.has("^")).toBe(false);
  });
});
