import { useCallback, useEffect, useRef } from "react";
import { TILE_REGISTRY } from "../../../shared/tileRegistry";
import type { TileChar } from "../../../shared/game.schema";

const CHUNK_SIZE = 16;
const TILE_W = 24;
const TILE_H = 12;
const CANVAS_W = 800;
const CANVAS_H = 420;
const OFFSET_X = 400;
const OFFSET_Y = 150;

interface ViewportProps {
  centerChunkX: number;
  centerChunkY: number;
  chunks: Record<string, string[][]>;
  entities?: { gridX: number; gridY: number; type?: "frog" | "predator" }[];
  selectedTile?: { gridX: number; gridY: number };
  onTileClick?: (gridX: number, gridY: number) => void;
}

export function Viewport({ centerChunkX, centerChunkY, chunks, entities, selectedTile, onTileClick }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Inverse isometric: screen → grid
  // Forward: screenX = (worldX - worldY) * 8 + 400, screenY = (worldX + worldY) * 4 + 150
  // Solving: worldX = u/TILE_W + v/TILE_H, worldY = v/TILE_H - u/TILE_W
  // where u = clickX - OFFSET_X, v = clickY - OFFSET_Y
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onTileClick) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const u = (e.clientX - rect.left) - OFFSET_X;
      const v = (e.clientY - rect.top)  - OFFSET_Y;
      const worldX = Math.round(u / TILE_W + v / TILE_H);
      const worldY = Math.round(v / TILE_H - u / TILE_W);
      onTileClick(worldX + centerChunkX * CHUNK_SIZE, worldY + centerChunkY * CHUNK_SIZE);
    },
    [onTileClick, centerChunkX, centerChunkY],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${centerChunkX + dx}:${centerChunkY + dy}`;
        const tileGrid = chunks[key];
        if (!tileGrid) continue;

        for (let ty = 0; ty < CHUNK_SIZE; ty++) {
          for (let tx = 0; tx < CHUNK_SIZE; tx++) {
            const char = tileGrid[ty]?.[tx] ?? "#";
            const worldX = dx * CHUNK_SIZE + tx;
            const worldY = dy * CHUNK_SIZE + ty;
            const screenX = Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X;
            const screenY = Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y;
            ctx.fillStyle = TILE_REGISTRY[char as TileChar]?.color ?? "#888888";
            ctx.fillText(char, screenX, screenY);
          }
        }
      }
    }

    if (entities) {
      for (const entity of entities) {
        const worldX = entity.gridX - centerChunkX * CHUNK_SIZE;
        const worldY = entity.gridY - centerChunkY * CHUNK_SIZE;
        const screenX = Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X;
        const screenY = Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y;
        ctx.fillStyle = entity.type === "predator" ? "#ff4444" : "#00ff88";
        ctx.fillRect(screenX - 4, screenY - 4, 9, 9);
      }
    }

    if (selectedTile) {
      const worldX = selectedTile.gridX - centerChunkX * CHUNK_SIZE;
      const worldY = selectedTile.gridY - centerChunkY * CHUNK_SIZE;
      const screenX = Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X;
      const screenY = Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y;
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1;
      ctx.strokeRect(screenX - 9, screenY - 7, 18, 14);
    }
  }, [centerChunkX, centerChunkY, chunks, entities, selectedTile]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      onClick={handleClick}
      style={{ background: "#000000", display: "block", cursor: onTileClick ? "crosshair" : "default" }}
    />
  );
}
