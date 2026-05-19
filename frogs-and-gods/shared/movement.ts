import type { TileChar } from "./game.schema";

export type MoveType = "STEP" | "HOP" | "SWIM";

// Open water tiles — frog standing here sees SWIM instead of HOP in the action bar.
export const OPEN_WATER_TILES = new Set<TileChar>(["≈", "~", "+"]);

// Tiles a frog may swim through (open water + lily pads).
export const SWIM_PASSABLE_TILES = new Set<TileChar>(["≈", "~", "+", "@", "%"]);

export function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

// Returns each tile stepped through from origin → destination (excluding origin, including destination).
// Uses a straight diagonal/orthogonal walk — the canonical path for hop blocking checks.
export function getHopPath(x1: number, y1: number, x2: number, y2: number): { x: number; y: number }[] {
  const dx    = Math.sign(x2 - x1);
  const dy    = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  const path: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    path.push({ x: x1 + dx * i, y: y1 + dy * i });
  }
  return path;
}

// Returns all grid tiles along the Bresenham line from (x1,y1) to (x2,y2),
// excluding origin, including destination. Works for any two points, not just
// cardinal/diagonal directions.
export function getLineTiles(x1: number, y1: number, x2: number, y2: number): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  const adx = Math.abs(x2 - x1);
  const ady = Math.abs(y2 - y1);
  const sx  = x1 < x2 ? 1 : -1;
  const sy  = y1 < y2 ? 1 : -1;
  let err   = adx - ady;
  let cx    = x1;
  let cy    = y1;

  while (true) {
    if (cx !== x1 || cy !== y1) tiles.push({ x: cx, y: cy });
    if (cx === x2 && cy === y2) break;
    const e2 = 2 * err;
    if (e2 > -ady) { err -= ady; cx += sx; }
    if (e2 <  adx) { err += adx; cy += sy; }
  }
  return tiles;
}
