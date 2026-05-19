export const WORLD_GRID_SIZE = 315;
export const GRID_RADIUS    = 157;  // (315 - 1) / 2
export const WOLFRAM_RULE   = 54;

const MAX_DIST = Math.sqrt(GRID_RADIUS * GRID_RADIUS + GRID_RADIUS * GRID_RADIUS);

function applyRule(rule: number, left: number, center: number, right: number): number {
  const pattern = (left << 2) | (center << 1) | right;
  return (rule >> pattern) & 1;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

export function buildMacroGrid(rule = WOLFRAM_RULE, seed = 42): Uint8Array {
  // Build 158 CA rows (row 0 = apex, row 157 = most spread).
  // After each row, mirror right half → left half so the CA evolves symmetrically.
  // Then assemble the 315×315 grid with vertical mirror around row 157 (center).
  const rowCount = GRID_RADIUS + 1;  // 158
  const rows: Uint8Array[] = [];

  let current = new Uint8Array(WORLD_GRID_SIZE);
  const rng = lcg(seed);
  for (let col = GRID_RADIUS; col < WORLD_GRID_SIZE; col++) {
    current[col] = rng() < 0.4 ? 1 : 0;  // 40% fill density on right half
  }
  for (let i = 1; i <= GRID_RADIUS; i++) {  // mirror right → left for initial row
    current[GRID_RADIUS - i] = current[GRID_RADIUS + i];
  }
  rows.push(new Uint8Array(current));

  for (let step = 1; step < rowCount; step++) {
    const next = new Uint8Array(WORLD_GRID_SIZE);
    for (let col = 0; col < WORLD_GRID_SIZE; col++) {
      const l = col > 0                    ? current[col - 1] : 0;
      const c = current[col];
      const r = col < WORLD_GRID_SIZE - 1  ? current[col + 1] : 0;
      next[col] = applyRule(rule, l, c, r);
    }
    // Mirror right half → left half to force bilateral symmetry during propagation
    for (let i = 1; i <= GRID_RADIUS; i++) {
      next[GRID_RADIUS - i] = next[GRID_RADIUS + i];
    }
    rows.push(new Uint8Array(next));
    current = next;
  }

  // Assemble 315×315 flat grid (row-major, index = row * WORLD_GRID_SIZE + col)
  // 2D center row (157) = CA row 0 (apex)
  // 2D rows 156..0   = CA rows 1..157  (upward)
  // 2D rows 158..314 = CA rows 1..157  (downward mirror)
  const full = new Uint8Array(WORLD_GRID_SIZE * WORLD_GRID_SIZE);

  for (let caRow = 0; caRow < rowCount; caRow++) {
    const rowData = rows[caRow];
    const upRow   = GRID_RADIUS - caRow;   // 157 down to 0
    const downRow = GRID_RADIUS + caRow;   // 157 up to 314

    for (let col = 0; col < WORLD_GRID_SIZE; col++) {
      full[upRow   * WORLD_GRID_SIZE + col] = rowData[col];
      if (downRow < WORLD_GRID_SIZE) {
        full[downRow * WORLD_GRID_SIZE + col] = rowData[col];
      }
    }
  }

  // OR with transpose: fills left/right corner regions so pattern covers the full square.
  // For every (r, c), either (r,c) or (c,r) is inside the vertical diamond, so union = full grid.
  for (let r = 0; r < WORLD_GRID_SIZE; r++) {
    for (let c = 0; c < WORLD_GRID_SIZE; c++) {
      if (full[c * WORLD_GRID_SIZE + r]) {
        full[r * WORLD_GRID_SIZE + c] = 1;
      }
    }
  }

  return full;
}

// Returns true if the chunk at (cx, cy) should receive tile generation.
// cx/cy are chunk coordinates relative to world center (range -157..+157).
export function isChunkSolid(cx: number, cy: number, macroGrid: Uint8Array): boolean {
  const col = cx + GRID_RADIUS;
  const row = cy + GRID_RADIUS;
  if (col < 0 || col >= WORLD_GRID_SIZE || row < 0 || row >= WORLD_GRID_SIZE) return false;

  const caValue = macroGrid[row * WORLD_GRID_SIZE + col];
  const dist    = Math.sqrt(cx * cx + cy * cy) / MAX_DIST;

  // Near center, CA weight fades to 0 so even CA=1 cells become void.
  // Edge term forces the outer ring solid regardless of CA.
  // CENTER_VOID_RADIUS: tune 0.2–0.5 — larger = bigger void core.
  const CENTER_VOID_RADIUS = 0.3;
  const caWeight = Math.min(1.0, dist / CENTER_VOID_RADIUS);
  return caValue * caWeight + dist * 0.8 >= 0.6;
}

// Pre-computed singleton — runs once at module load (pure math, no I/O, ~97 KB).
export const MACRO_GRID = buildMacroGrid(WOLFRAM_RULE, 42);
