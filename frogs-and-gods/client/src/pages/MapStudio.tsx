import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { spriteManager, SpriteManager } from "@/lib/SpriteManager";
import { TILE_REGISTRY } from "../../../shared/tileRegistry";
import type { TileChar } from "../../../shared/game.schema";

const frogSpriteManager = new SpriteManager();

const CHUNK_SIZE = 16;
const BASE_TILE_W = 24;
const BASE_TILE_H = 12;

type ScaleOption = 1 | 2 | 3;

export default function MapStudio() {
  const [centerChunkX, setCenterChunkX] = useState(0);
  const [centerChunkY, setCenterChunkY] = useState(0);
  const [inputX, setInputX] = useState("0");
  const [inputY, setInputY] = useState("0");
  const [radius, setRadius] = useState(3);
  const [scale, setScale] = useState<ScaleOption>(2);
  const [showEntities, setShowEntities] = useState(true);
  const [showItems, setShowItems] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = trpc.admin.getMapStudioChunks.useQuery(
    { centerChunkX, centerChunkY, radius },
  );

  // Lazy-load sprites for any new item IDs
  const newItemIds = (data?.items ?? [])
    .map((i) => i.itemId)
    .filter((id) => !spriteManager.has(id));
  const pixelQuery = trpc.frog.getItemPixelData.useQuery(
    { itemIds: newItemIds },
    { enabled: newItemIds.length > 0 },
  );
  useEffect(() => {
    if (!pixelQuery.data) return;
    for (const { itemId, pixelData } of pixelQuery.data) {
      if (pixelData) spriteManager.bake(itemId, pixelData);
    }
  }, [pixelQuery.data]);

  // Canvas dimensions derived from radius + scale
  const D = (2 * radius + 1) * CHUNK_SIZE;
  const TILE_W = BASE_TILE_W * scale;
  const TILE_H = BASE_TILE_H * scale;
  const CANVAS_W = D * TILE_W;
  const CANVAS_H = D * TILE_H + TILE_H;
  const OFFSET_X = CANVAS_W / 2;
  // Top tile of the diamond is at worldX+worldY = -2*radius*CHUNK_SIZE.
  // To place it TILE_H from the canvas top: OFFSET_Y = TILE_H + radius*CHUNK_SIZE*(TILE_H/2)*2
  const OFFSET_Y = TILE_H * (1 + radius * CHUNK_SIZE);

  const tileToScreen = useCallback(
    (gridX: number, gridY: number) => {
      const worldX = gridX - centerChunkX * CHUNK_SIZE;
      const worldY = gridY - centerChunkY * CHUNK_SIZE;
      return {
        screenX: Math.floor((worldX - worldY) * (TILE_W / 2)) + OFFSET_X,
        screenY: Math.floor((worldX + worldY) * (TILE_H / 2)) + OFFSET_Y,
      };
    },
    [centerChunkX, centerChunkY, TILE_W, TILE_H, OFFSET_X, OFFSET_Y],
  );

  // Bake frog sprites from modelJson included in the response
  useEffect(() => {
    if (!data) return;
    for (const f of data.frogs) {
      if (f.modelJson) frogSpriteManager.bake(String(f.id), f.modelJson);
    }
  }, [data]);

  // Re-render whenever data, scale, radius, or toggle state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    (ctx as CanvasRenderingContext2D & Record<string, unknown>).imageSmoothingEnabled = false;

    if (!data) {
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#6b7280";
      ctx.fillText(`Loading chunks at (${centerChunkX}, ${centerChunkY})…`, CANVAS_W / 2, CANVAS_H / 2);
      return;
    }

    ctx.font = `bold ${Math.round(scale * 12)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Pass 1: terrain tiles
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const key = `${centerChunkX + dx}:${centerChunkY + dy}`;
        const tileGrid = data.chunks[key];
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

    // No terrain: show a legible message rather than silent black
    if (Object.keys(data.chunks).length === 0) {
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#4b5563";
      ctx.fillText(`No chunk data at (${centerChunkX}, ${centerChunkY})`, CANVAS_W / 2, CANVAS_H / 2);
      ctx.fillStyle = "#374151";
      ctx.fillText("Seeded world covers roughly −4..+4 on each axis.", CANVAS_W / 2, CANVAS_H / 2 + 22);
      return;
    }

    // Pass 2: ground items
    if (showItems) {
      const spriteOffset = Math.round(scale * 9);
      const spriteSize = Math.round(scale * 18);
      for (const item of data.items) {
        if (item.gridX == null || item.gridY == null) continue;
        const { screenX, screenY } = tileToScreen(item.gridX, item.gridY);
        const spriteCanvas = spriteManager.get(item.itemId);
        if (spriteCanvas) {
          ctx.drawImage(spriteCanvas, screenX - spriteOffset, screenY - spriteOffset, spriteSize, spriteSize);
        } else {
          ctx.fillStyle = "#f472b6";
          ctx.fillRect(screenX - scale * 3, screenY - scale * 3, scale * 7, scale * 7);
        }
      }
    }

    // Pass 3: entities
    if (showEntities) {
      const frogSpriteOffset = Math.round(scale * 9);
      const frogSpriteSize = Math.round(scale * 18);
      for (const entity of data.frogs) {
        const { screenX, screenY } = tileToScreen(entity.gridX, entity.gridY);
        const frogSprite = entity.id != null ? frogSpriteManager.get(String(entity.id)) : undefined;
        if (frogSprite) {
          ctx.drawImage(frogSprite, screenX - frogSpriteOffset, screenY - frogSpriteOffset, frogSpriteSize, frogSpriteSize);
        } else {
          ctx.fillStyle = "#00ff88";
          ctx.fillRect(screenX - scale * 4, screenY - scale * 4, scale * 9, scale * 9);
        }
      }
      for (const predator of data.predators) {
        const { screenX, screenY } = tileToScreen(predator.gridX, predator.gridY);
        ctx.fillStyle = "#ff4444";
        ctx.fillText("S", screenX, screenY);
      }
    }
  }, [
    data, scale, radius, showEntities, showItems,
    centerChunkX, centerChunkY,
    CANVAS_W, CANVAS_H, TILE_W, TILE_H, OFFSET_X, OFFSET_Y,
    tileToScreen,
  ]);

  // Scroll the canvas container so the center chunk tile is centered in the viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data) return;
    container.scrollLeft = Math.max(0, OFFSET_X - container.clientWidth / 2);
    container.scrollTop = Math.max(0, OFFSET_Y - container.clientHeight / 2);
  }, [data, OFFSET_X, OFFSET_Y]);

  const applyCoords = () => {
    const x = parseInt(inputX, 10);
    const y = parseInt(inputY, 10);
    if (!isNaN(x) && !isNaN(y)) {
      setCenterChunkX(x);
      setCenterChunkY(y);
    }
  };

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `frogs-map-${centerChunkX}-${centerChunkY}-r${radius}-s${scale}x.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "#6b7280",
    fontFamily: "'Cinzel', serif",
    letterSpacing: "0.06em",
    marginBottom: 3,
  };

  const inputStyle: React.CSSProperties = {
    background: "#0a1120",
    border: "1px solid #1e2a3a",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "4px 8px",
    fontSize: 13,
    width: 60,
    fontFamily: "monospace",
  };

  const selectStyle: React.CSSProperties = {
    background: "#0a1120",
    border: "1px solid #1e2a3a",
    borderRadius: 4,
    color: "#e2e8f0",
    padding: "4px 8px",
    fontSize: 13,
    fontFamily: "monospace",
    cursor: "pointer",
  };

  const btnStyle: React.CSSProperties = {
    padding: "6px 14px",
    fontSize: 12,
    fontFamily: "'Cinzel', serif",
    letterSpacing: "0.06em",
    borderRadius: 6,
    cursor: "pointer",
    border: "1px solid",
  };

  return (
    <div style={{ background: "#030712", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Controls Bar ─────────────────────────────────── */}
      <div
        style={{
          padding: "10px 20px",
          borderBottom: "1px solid #1e2a3a",
          display: "flex",
          alignItems: "flex-end",
          gap: 20,
          flexWrap: "wrap",
          flexShrink: 0,
        }}
      >
        {/* Back link */}
        <Link href="/">
          <span
            style={{
              fontSize: 12,
              fontFamily: "'Cinzel', serif",
              color: "#6b7280",
              letterSpacing: "0.06em",
              cursor: "pointer",
              paddingBottom: 2,
            }}
          >
            ← ADMIN
          </span>
        </Link>

        <span
          style={{
            fontSize: 14,
            fontFamily: "'Cinzel', serif",
            color: "#fde68a",
            letterSpacing: "0.1em",
            paddingBottom: 2,
          }}
        >
          MAP STUDIO
        </span>

        {/* Center chunk coords */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>CENTER X</span>
            <input
              style={inputStyle}
              value={inputX}
              onChange={(e) => setInputX(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCoords()}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={labelStyle}>CENTER Y</span>
            <input
              style={inputStyle}
              value={inputY}
              onChange={(e) => setInputY(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyCoords()}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <button
              style={{
                ...btnStyle,
                background: "#0f1929",
                borderColor: "#1e2a3a",
                color: "#e2e8f0",
              }}
              onClick={applyCoords}
            >
              GO
            </button>
          </div>
        </div>

        {/* Radius */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>RADIUS</span>
          <select
            style={selectStyle}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r} ({(2 * r + 1)}×{(2 * r + 1)} chunks)
              </option>
            ))}
          </select>
        </div>

        {/* Scale */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={labelStyle}>SCALE</span>
          <select
            style={selectStyle}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value) as ScaleOption)}
          >
            <option value={1}>1× (24px tiles)</option>
            <option value={2}>2× (48px tiles)</option>
            <option value={3}>3× (72px tiles)</option>
          </select>
        </div>

        {/* Toggles */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showEntities}
              onChange={(e) => setShowEntities(e.target.checked)}
              style={{ accentColor: "#00ff88" }}
            />
            <span style={{ ...labelStyle, marginBottom: 0, color: "#9ca3af" }}>ENTITIES</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showItems}
              onChange={(e) => setShowItems(e.target.checked)}
              style={{ accentColor: "#f472b6" }}
            />
            <span style={{ ...labelStyle, marginBottom: 0, color: "#9ca3af" }}>ITEMS</span>
          </label>
        </div>

        {/* Status */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
          {isFetching && (
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "#9ca3af", letterSpacing: "0.04em" }}>
              fetching ({centerChunkX}, {centerChunkY})…
            </span>
          )}
          {!isFetching && data && (
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "#6b7280" }}>
              {CANVAS_W}×{CANVAS_H}px · {Object.keys(data.chunks).length} chunks · center ({centerChunkX}, {centerChunkY})
            </span>
          )}
        </div>

        {/* Download */}
        <button
          style={{
            ...btnStyle,
            background: "#0f2d1f",
            borderColor: "#1a4a30",
            color: "#4ade80",
          }}
          onClick={downloadPng}
        >
          ⬇ SAVE PNG
        </button>
      </div>

      {/* ── Canvas Area ───────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          background: "#000000",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ display: "block" }}
        />
      </div>
    </div>
  );
}
