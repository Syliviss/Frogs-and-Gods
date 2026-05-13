import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getTileDef } from "../../../../shared/tileRegistry";

const BIOME_COLORS: Record<string, string> = {
  grassland: "#5f9a30",
  forest:    "#2d6b2d",
  swamp:     "#4a6b20",
  desert:    "#c4a35a",
  mountain:  "#8a8a8a",
  void:      "#1a1a2e",
};

const CANVAS_SIZE = 315;

export function WorldInspectorTab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inspectedChunk, setInspectedChunk] = useState<{ chunkX: number; chunkY: number } | null>(null);

  const { data: biomeData, isLoading: biomesLoading } = trpc.admin.getAllChunkBiomes.useQuery(undefined, {
    staleTime: 60_000,
  });

  const { data: poiData } = trpc.admin.getPoiRegistry.useQuery();

  const { data: chunkTerrain } = trpc.admin.getChunksByCoords.useQuery(
    { coords: inspectedChunk ? [inspectedChunk] : [] },
    { enabled: !!inspectedChunk },
  );

  // Draw biome coverage canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !biomeData) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = BIOME_COLORS.void;
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    for (const { chunkX, chunkY, biome } of biomeData) {
      const px = chunkX + 157;
      const py = chunkY + 157;
      ctx.fillStyle = BIOME_COLORS[biome] ?? "#444";
      ctx.fillRect(px, py, 1, 1);
    }
  }, [biomeData]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    const px = Math.floor((e.clientX - rect.left) * scaleX);
    const py = Math.floor((e.clientY - rect.top)  * scaleY);
    setInspectedChunk({ chunkX: px - 157, chunkY: py - 157 });
  }

  const inspectedKey  = inspectedChunk ? `${inspectedChunk.chunkX}:${inspectedChunk.chunkY}` : null;
  const inspectedGrid = inspectedKey && chunkTerrain ? chunkTerrain[inspectedKey] : null;

  return (
    <div style={{ display: "flex", gap: 24, padding: 16, flexWrap: "wrap" }}>

      {/* Biome Coverage Map */}
      <div>
        <h3 style={{ marginBottom: 8, fontWeight: 600 }}>Biome Coverage (315×315 chunks)</h3>
        {biomesLoading && <p style={{ color: "#888" }}>Loading biome data…</p>}
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onClick={handleCanvasClick}
          style={{
            display:      "block",
            border:       "1px solid #333",
            cursor:       "crosshair",
            imageRendering: "pixelated",
            width:        CANVAS_SIZE,
            height:       CANVAS_SIZE,
          }}
        />
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          {Object.entries(BIOME_COLORS).map(([biome, color]) => (
            <span key={biome} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <span style={{ width: 12, height: 12, background: color, display: "inline-block", border: "1px solid #555" }} />
              {biome}
            </span>
          ))}
        </div>
      </div>

      {/* Right column */}
      <div style={{ flex: 1, minWidth: 280 }}>

        {/* Chunk Inspector */}
        {inspectedChunk && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>
              Chunk ({inspectedChunk.chunkX}, {inspectedChunk.chunkY})
            </h3>
            {inspectedGrid ? (
              <pre style={{
                fontFamily:  "monospace",
                fontSize:    11,
                lineHeight:  "14px",
                letterSpacing: "2px",
                background:  "#111",
                padding:     8,
                borderRadius: 4,
                overflowX:   "auto",
              }}>
                {inspectedGrid.map((row, y) => (
                  <span key={y} style={{ display: "block" }}>
                    {row.map((char, x) => {
                      const tileDef = getTileDef(char);
                      return (
                        <span key={x} style={{ color: tileDef?.color ?? "#fff" }}>{char}</span>
                      );
                    })}
                  </span>
                ))}
              </pre>
            ) : (
              <p style={{ color: "#888", fontSize: 13 }}>Void chunk — no terrain data.</p>
            )}
          </div>
        )}

        {/* POI List */}
        <div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>POI Registry</h3>
          {!poiData || poiData.length === 0 ? (
            <p style={{ color: "#888", fontSize: 13 }}>No POIs defined yet.</p>
          ) : (
            <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #333" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Name</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Type</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>Anchor</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>Tiles</th>
                </tr>
              </thead>
              <tbody>
                {poiData.map((poi) => (
                  <tr
                    key={poi.id}
                    style={{ borderBottom: "1px solid #222", cursor: "pointer" }}
                    onClick={() => setInspectedChunk({
                      chunkX: Math.floor(poi.anchorX / 16),
                      chunkY: Math.floor(poi.anchorY / 16),
                    })}
                  >
                    <td style={{ padding: "4px 8px" }}>{poi.name}</td>
                    <td style={{ padding: "4px 8px", color: "#888" }}>{poi.type}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>{poi.anchorX}, {poi.anchorY}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }}>{poi.tileCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}
