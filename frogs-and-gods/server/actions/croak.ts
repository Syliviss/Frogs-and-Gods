import { pushActionLog } from "../engine/actionLog";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import type { FrogStats } from "../../drizzle/schema";
import { CHUNK_SIZE } from "../utils/worldGenerator";

export const croakHandler: ActionHandler = {
  validate(_ctx: ActionContext, _state: SimulatedState): ValidationResult {
    return { ok: true };
  },

  execute(ctx: ActionContext, state: SimulatedState, out: UpdateInstruction[]): ExecuteResult {
    const frog = ctx.frog!;
    const maxBreath = (frog.statsJson as FrogStats).maxBreath ?? 5;
    state.updateFrog(ctx.frogId, { currentBreath: maxBreath });
    out.push({ type: "FROG_UPDATE", id: ctx.frogId, changes: { currentBreath: maxBreath } });

    // Croak attracts snakes — overworld only (lairs are god-controlled spaces)
    if (frog.instanceId == null) {
      const frogCX = Math.floor(frog.gridX / CHUNK_SIZE);
      const frogCY = Math.floor(frog.gridY / CHUNK_SIZE);

      const landTiles: { gridX: number; gridY: number }[] = [];
      let totalTiles = 0;
      let landAndPeakCount = 0;

      for (let cx = frogCX - 1; cx <= frogCX + 1; cx++) {
        for (let cy = frogCY - 1; cy <= frogCY + 1; cy++) {
          const chunk = state.chunks.get(`${cx},${cy}`);
          if (!chunk?.terrainDataJson) continue;
          let terrain: string[][];
          try { terrain = JSON.parse(chunk.terrainDataJson) as string[][]; }
          catch { continue; }
          for (let ly = 0; ly < terrain.length; ly++) {
            const row = terrain[ly];
            if (!row) continue;
            for (let lx = 0; lx < row.length; lx++) {
              const char = row[lx];
              totalTiles++;
              if (char === "#") {
                landTiles.push({ gridX: cx * CHUNK_SIZE + lx, gridY: cy * CHUNK_SIZE + ly });
                landAndPeakCount++;
              } else if (char === "^") {
                landAndPeakCount++;
              }
            }
          }
        }
      }

      if (landTiles.length > 0 && totalTiles > 0) {
        const density = landAndPeakCount / totalTiles;
        const spawnChance = density >= 0.45 ? 0.20 : 0.03;

        if (Math.random() < spawnChance) {
          const tile = landTiles[Math.floor(Math.random() * landTiles.length)]!;
          out.push({
            type: "PREDATOR_INSERT",
            data: {
              enemyType: "SNAKE",
              aiType: "HUNTER",
              gridX: tile.gridX,
              gridY: tile.gridY,
              chunkX: Math.floor(tile.gridX / CHUNK_SIZE),
              chunkY: Math.floor(tile.gridY / CHUNK_SIZE),
              currentHp: 10,
              lastMealTick: Math.floor(Date.now() / 10_000),
              statsJson: {
                speed: 5,
                segments: [
                  { x: tile.gridX - 1, y: tile.gridY },
                  { x: tile.gridX - 2, y: tile.gridY },
                ],
              },
            },
          });
        }
      }
    }

    return { success: true, data: { maxBreath } };
  },

  broadcast(ctx: ActionContext, result: ExecuteResult, _notify: NotifyFn): void {
    const frog = ctx.frog!;
    const { maxBreath } = result.data as { maxBreath: number };
    pushActionLog({
      text:     `${frog.name} croaks! (breath restored to ${maxBreath})`,
      x:        frog.gridX,
      y:        frog.gridY,
      chunk_id: `${Math.floor(frog.gridX / CHUNK_SIZE)}:${Math.floor(frog.gridY / CHUNK_SIZE)}`,
      category: "movement",
    });
  },
};
