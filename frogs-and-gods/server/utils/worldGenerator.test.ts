import { describe, it, expect } from "vitest";
import { generateChunk, CHUNK_SIZE } from "./worldGenerator";

// Chunk (0,0) is void by design (center of map has a void zone).
// Tests use solid chunks at distance >30 from center with the world seed.
describe("generateChunk", () => {
  it("returns a deterministic 16×16 ASCII grid for a solid chunk", () => {
    const a = generateChunk(30, 35, 42);
    const b = generateChunk(30, 35, 42);

    expect(a).toHaveLength(CHUNK_SIZE);
    expect(a[0]).toHaveLength(CHUNK_SIZE);
    expect(a).toEqual(b);
  });

  it("produces different output for different chunk positions", () => {
    const home = generateChunk(30, 35, 42);
    const away = generateChunk(45, 30, 42);
    expect(home).not.toEqual(away);
  });
});
