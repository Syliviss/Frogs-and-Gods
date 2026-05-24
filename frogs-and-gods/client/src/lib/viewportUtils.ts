// Single source of truth for expanding predators into per-tile viewport entities.
// Both the player viewport (Admin.tsx) and the god viewport (GodViewTab.tsx) call
// this function so new entity types only need to be added in one place.

export type ViewportEntity = {
  gridX:      number;
  gridY:      number;
  type:       "frog" | "predator";
  id?:        number;
  enemyType?: string;
};

type PredatorLike = {
  id:        number;
  gridX:     number;
  gridY:     number;
  enemyType: string;
  statsJson: unknown;
};

export function flattenPredators(predators: PredatorLike[]): ViewportEntity[] {
  return predators.flatMap((p) => {
    if (p.enemyType === "GOLEM") {
      const tiles: ViewportEntity[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          tiles.push({ gridX: p.gridX + dx, gridY: p.gridY + dy, type: "predator", id: p.id, enemyType: "GOLEM" });
        }
      }
      return tiles;
    }
    const stats = p.statsJson as { segments?: { x: number; y: number }[] } | null;
    const head: ViewportEntity   = { gridX: p.gridX, gridY: p.gridY, type: "predator", id: p.id, enemyType: p.enemyType };
    const body: ViewportEntity[] = (stats?.segments ?? []).map((s) => ({
      gridX: s.x, gridY: s.y, type: "predator", id: p.id, enemyType: p.enemyType,
    }));
    return [head, ...body];
  });
}
