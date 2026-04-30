import { useEffect, useRef } from "react";

const CHUNK_SIZE = 16;
const TILE_W = 16;
const TILE_H = 8;
const CANVAS_W = 800;
const CANVAS_H = 420;
const OFFSET_X = 400;
const OFFSET_Y = 150;

const TILE_COLOR: Record<string, string> = {
  "≈": "#1a5f8a",
  "+": "#2a7a5a",
  "~": "#1e8870",
  "@": "#4a7a20",
  "#": "#5f9a30",
};

interface ViewportProps {
  centerChunkX: number;
  centerChunkY: number;
  chunks: Record<string, string[][]>;
}

export function Viewport({ centerChunkX, centerChunkY, chunks }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.font = "bold 8px monospace";
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
            ctx.fillStyle = TILE_COLOR[char] ?? "#888888";
            ctx.fillText(char, screenX, screenY);
          }
        }
      }
    }
  }, [centerChunkX, centerChunkY, chunks]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ background: "#000000", display: "block" }}
    />
  );
}
