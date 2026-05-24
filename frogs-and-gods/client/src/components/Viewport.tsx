import { useCallback, useEffect, useRef } from "react";

export interface FloatingText {
  gridX:     number;
  gridY:     number;
  text:      string;
  createdAt: number;
}
import { TILE_REGISTRY } from "../../../shared/tileRegistry";
import type { TileChar } from "../../../shared/game.schema";
import { spriteManager, SpriteManager } from "../lib/SpriteManager";

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
  entities?: { gridX: number; gridY: number; type?: "frog" | "predator"; id?: number; enemyType?: string }[];
  groundItems?: { gridX: number; gridY: number; itemId: string }[];
  selectedTile?: { gridX: number; gridY: number };
  onTileClick?: (gridX: number, gridY: number) => void;
  /** Tiles the player has confirmed as targets — rendered with a red overlay */
  targetingTiles?: { gridX: number; gridY: number }[];
  /** Tile currently under the cursor during targeting — rendered with an orange overlay */
  hoveredTargetTile?: { gridX: number; gridY: number };
  onTileHover?: (gridX: number, gridY: number) => void;
  /** Called on right-click — used to cancel targeting mode */
  onTileRightClick?: () => void;
  /** Separate sprite cache for frog models — baked on vision arrival, pruned when entities leave */
  frogSpriteManager?: SpriteManager;
  /** Incremented after sprites are baked; causes canvas to redraw with fresh sprites */
  spriteVersion?: number;
  /** Floating text overlays (e.g. "croak!") — faded out over 1 second by the overlay rAF loop */
  floatingTexts?: FloatingText[];
}

export function Viewport({
  centerChunkX,
  centerChunkY,
  chunks,
  entities,
  groundItems,
  selectedTile,
  onTileClick,
  targetingTiles,
  hoveredTargetTile,
  onTileHover,
  onTileRightClick,
  frogSpriteManager,
  spriteVersion: _spriteVersion,
  floatingTexts,
}: ViewportProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Shared inverse isometric transform: screen coordinates → absolute grid tile
  // Forward: screenX = (worldX - worldY) * (TILE_W/2) + 400, screenY = (worldX + worldY) * (TILE_H/2) + 150
  // Solving for world: worldX = u/TILE_W + v/TILE_H, worldY = v/TILE_H - u/TILE_W
  const screenToGrid = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => {
      const u = (clientX - rect.left)  - OFFSET_X;
      const v = (clientY - rect.top)   - OFFSET_Y;
      const worldX = Math.round(u / TILE_W + v / TILE_H);
      const worldY = Math.round(v / TILE_H - u / TILE_W);
      return {
        gridX: worldX + centerChunkX * CHUNK_SIZE,
        gridY: worldY + centerChunkY * CHUNK_SIZE,
      };
    },
    [centerChunkX, centerChunkY],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onTileClick) return;
      const { gridX, gridY } = screenToGrid(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      onTileClick(gridX, gridY);
    },
    [onTileClick, screenToGrid],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onTileHover) return;
      const { gridX, gridY } = screenToGrid(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
      onTileHover(gridX, gridY);
    },
    [onTileHover, screenToGrid],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      onTileRightClick?.();
    },
    [onTileRightClick],
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

    // Pixel-art quality: disable interpolation so 16×16→24×24 stays blocky
    (ctx as any).imageSmoothingEnabled       = false;
    (ctx as any).msImageSmoothingEnabled     = false;
    (ctx as any).webkitImageSmoothingEnabled = false;
    (ctx as any).mozImageSmoothingEnabled    = false;

    // Helper: tile world coords → screen coords
    const tileToScreen = (gridX: number, gridY: number) => {
      const worldX = gridX - centerChunkX * CHUNK_SIZE;
      const worldY = gridY - centerChunkY * CHUNK_SIZE;
      return {
        screenX: Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X,
        screenY: Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y,
      };
    };

    // Pass 1: terrain tiles (3×3 chunk neighbourhood)
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

    // Pass 2: ground items — drawn before entities so frogs appear on top
    if (groundItems) {
      for (const item of groundItems) {
        const { screenX, screenY } = tileToScreen(item.gridX, item.gridY);
        const spriteCanvas = spriteManager.get(item.itemId);
        if (spriteCanvas) {
          ctx.drawImage(spriteCanvas, screenX - 9, screenY - 9, 18, 18);
        } else {
          // Fallback: pink square for items without baked sprite data
          ctx.fillStyle = "#f472b6";
          ctx.fillRect(screenX - 3, screenY - 3, 7, 7);
        }
      }
    }

    // Pass 3: entities (frogs & predators) — stand above the earth and its treasures
    if (entities) {
      for (const entity of entities) {
        const { screenX, screenY } = tileToScreen(entity.gridX, entity.gridY);
        if (entity.type === "predator") {
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#000000";
          if (entity.enemyType === "GOLEM") {
            ctx.strokeText("G", screenX, screenY);
            ctx.fillStyle = "#808080";
            ctx.fillText("G", screenX, screenY);
          } else {
            ctx.strokeText("S", screenX, screenY);
            ctx.fillStyle = "#ff4444";
            ctx.fillText("S", screenX, screenY);
          }
          ctx.restore();
        } else {
          const frogSprite = entity.id != null ? frogSpriteManager?.get(String(entity.id)) : undefined;
          if (frogSprite) {
            ctx.drawImage(frogSprite, screenX - 9, screenY - 9, 18, 18);
          } else {
            ctx.fillStyle = "#00ff88";
            ctx.fillRect(screenX - 4, screenY - 4, 9, 9);
          }
        }
      }
    }

    // Pass 4: selected tile highlight (yellow stroke)
    if (selectedTile) {
      const { screenX, screenY } = tileToScreen(selectedTile.gridX, selectedTile.gridY);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1;
      ctx.strokeRect(screenX - 9, screenY - 7, 18, 14);
    }

    // Pass 5a: confirmed targeting tiles — semi-transparent red fill
    if (targetingTiles && targetingTiles.length > 0) {
      ctx.fillStyle = "rgba(255, 0, 0, 0.35)";
      for (const tile of targetingTiles) {
        const { screenX, screenY } = tileToScreen(tile.gridX, tile.gridY);
        ctx.fillRect(screenX - 9, screenY - 7, 18, 14);
      }
    }

    // Pass 5b: hovered target tile — semi-transparent orange (renders on top of red)
    if (hoveredTargetTile) {
      const { screenX, screenY } = tileToScreen(hoveredTargetTile.gridX, hoveredTargetTile.gridY);
      ctx.fillStyle = "rgba(255, 165, 0, 0.55)";
      ctx.fillRect(screenX - 9, screenY - 7, 18, 14);
    }
  }, [
    centerChunkX, centerChunkY, chunks, entities, groundItems,
    selectedTile, targetingTiles, hoveredTargetTile, frogSpriteManager, _spriteVersion,
  ]);

  // Overlay rAF loop — draws floating texts with fade + upward drift, independent of main canvas
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !floatingTexts || floatingTexts.length === 0) {
      overlayRef.current?.getContext("2d")?.clearRect(0, 0, CANVAS_W, CANVAS_H);
      return;
    }
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    const draw = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      const now = Date.now();
      let anyActive = false;

      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const ft of floatingTexts) {
        const elapsed = now - ft.createdAt;
        if (elapsed >= 1000) continue;
        anyActive = true;

        const worldX = ft.gridX - centerChunkX * CHUNK_SIZE;
        const worldY = ft.gridY - centerChunkY * CHUNK_SIZE;
        const screenX = Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X;
        const baseY   = Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y;
        const textY   = baseY - 20 - elapsed * 0.014; // drifts ~14px upward over 1s

        const alpha = 1 - elapsed / 1000;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeText(ft.text, screenX, textY);
        ctx.fillStyle = "#88ffcc";
        ctx.fillText(ft.text, screenX, textY);
      }

      ctx.globalAlpha = 1;

      if (anyActive) {
        rafId = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [floatingTexts, centerChunkX, centerChunkY]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      onClick={handleClick}
      onMouseMove={onTileHover ? handleMouseMove : undefined}
      onContextMenu={onTileRightClick ? handleContextMenu : undefined}
      style={{
        background: "#000000",
        display: "block",
        cursor: (onTileClick || onTileHover) ? "crosshair" : "default",
      }}
    />
    <canvas
      ref={overlayRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    />
    </div>
  );
}
