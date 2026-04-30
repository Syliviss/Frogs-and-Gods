import { describe, it, expect } from "vitest";
import { generateChunk, CHUNK_SIZE } from "./worldGenerator";

describe("generateChunk", () => {
  it("returns a deterministic 16×16 ASCII grid for seed 12345", () => {
    const a = generateChunk(0, 0, 12345);
    const b = generateChunk(0, 0, 12345);

    expect(a).toHaveLength(CHUNK_SIZE);
    expect(a[0]).toHaveLength(CHUNK_SIZE);
    expect(a).toEqual(b);
  });

  it("produces different output for different chunk positions", () => {
    const home = generateChunk(0, 0, 12345);
    const away = generateChunk(5, 3, 12345);
    expect(home).not.toEqual(away);
  });
});
