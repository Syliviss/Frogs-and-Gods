import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useTickSync } from "@/hooks/useTickSync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const GRID_SIZE = 16;
const BLANK_GRID = (): string[][] =>
  Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill("+"));

const PALETTE_TILES = [
  { char: "+", label: "Shore",      color: "#2a7a5a" },
  { char: "~", label: "River",      color: "#1e8870" },
  { char: "≈", label: "Deep Lake",  color: "#1a5f8a" },
  { char: "#", label: "Land",       color: "#5f9a30" },
  { char: "D", label: "Lair Door",  color: "#9333ea" },
] as const;

function getTileColor(char: string): string {
  return PALETTE_TILES.find(t => t.char === char)?.color ?? "#374151";
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

export function LairTab() {
  const [selectedGodId, setSelectedGodId]         = useState<number | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [localGrid, setLocalGrid]                 = useState<string[][]>(BLANK_GRID);
  const [activeTile, setActiveTile]               = useState<string>("+");
  const [entranceX, setEntranceX]                 = useState<number>(0);
  const [entranceY, setEntranceY]                 = useState<number>(0);
  const [error, setError]                         = useState<string | null>(null);
  const [successMsg, setSuccessMsg]               = useState<string | null>(null);

  // ── Queries ──
  const { data: gods }            = trpc.admin.listGods.useQuery();
  const { data: instances, refetch: refetchInstances } = trpc.admin.getLairsByGod.useQuery(
    { godId: selectedGodId! },
    { enabled: selectedGodId !== null }
  );
  const { data: entranceCountData } = trpc.admin.getLairEntranceCountForGod.useQuery(
    { godId: selectedGodId! },
    { enabled: selectedGodId !== null }
  );

  // ── Mutations ──
  const stageMut = trpc.admin.stageLairTileData.useMutation({
    onSuccess: (data) => {
      setSelectedInstanceId(data.instanceId);
      void refetchInstances();
      setSuccessMsg(`Layout staged (action #${data.pendingActionId}). Resolves next heartbeat.`);
      setError(null);
    },
    onError: (e) => { setError(e.message); setSuccessMsg(null); },
  });

  const placeMut = trpc.admin.submitDivPlaceLair.useMutation({
    onSuccess: (data) => {
      setSuccessMsg(`Entrance queued (action #${data.pendingActionId}). Resolves next heartbeat.`);
      setError(null);
    },
    onError: (e) => { setError(e.message); setSuccessMsg(null); },
  });

  // ── Refresh instances on each 10s tick ──
  useTickSync(() => {
    if (selectedGodId !== null) void refetchInstances();
  });

  // ── When instance selection changes, load its layout into localGrid ──
  const selectedInstance = instances?.find(i => i.id === selectedInstanceId) ?? null;

  useEffect(() => {
    if (!selectedInstance) return;
    const layoutJson = selectedInstance.tileDataJson ?? selectedInstance.stagedTileDataJson;
    if (layoutJson) {
      try {
        const parsed = JSON.parse(layoutJson) as string[][];
        if (Array.isArray(parsed) && parsed.length === GRID_SIZE) {
          setLocalGrid(parsed);
          return;
        }
      } catch { /* fall through */ }
    }
    setLocalGrid(BLANK_GRID());
  }, [selectedInstanceId]);

  // ── Computed values ──
  const dCount = localGrid.flat().filter(c => c === "D").length;

  const committedGrid: string[][] | null = selectedInstance?.tileDataJson
    ? (() => { try { return JSON.parse(selectedInstance.tileDataJson) as string[][]; } catch { return null; } })()
    : null;

  const changedTiles = committedGrid
    ? localGrid.flat().filter((c, idx) => c !== committedGrid.flat()[idx]).length
    : 0;
  const favorCost = changedTiles * 5;

  const entranceCount = entranceCountData?.count ?? 0;
  const isFirstEntrance = entranceCount === 0;
  const placementCost = isFirstEntrance ? 0 : 50;

  // ── Handlers ──
  function handleCellClick(row: number, col: number) {
    setLocalGrid(prev => {
      const next = prev.map(r => [...r]);
      // Enforce at most 1 "D": clear existing D if placing a new one
      if (activeTile === "D") {
        for (let r = 0; r < GRID_SIZE; r++)
          for (let c = 0; c < GRID_SIZE; c++)
            if (next[r]![c] === "D") next[r]![c] = "+";
      }
      next[row]![col] = activeTile;
      return next;
    });
  }

  function handleCreateLair() {
    if (!selectedGodId) return;
    setError(null);
    setSuccessMsg(null);
    const blank = BLANK_GRID();
    blank[8]![8] = "D"; // place default D so it's valid from the start
    stageMut.mutate({ godId: selectedGodId, tileDataJson: blank });
    setLocalGrid(blank);
  }

  function handleSubmitLayout() {
    if (!selectedGodId || !selectedInstanceId || dCount !== 1) return;
    setError(null);
    setSuccessMsg(null);
    stageMut.mutate({ godId: selectedGodId, instanceId: selectedInstanceId, tileDataJson: localGrid });
  }

  function handlePlaceEntrance() {
    if (!selectedGodId || !selectedInstanceId) return;
    setError(null);
    setSuccessMsg(null);
    placeMut.mutate({ godId: selectedGodId, instanceId: selectedInstanceId, targetGridX: entranceX, targetGridY: entranceY });
  }

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 4 }}>

      {/* ── Section 1: God + Instance selection ── */}
      <div style={{
        background: "#0d1b2a", border: "1px solid #1e2a3a",
        borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12,
      }}>
        <h3 style={{ color: "#fde68a", margin: 0, fontSize: 15 }}>God's Lair — Instance Manager</h3>

        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label style={{ color: "#9ca3af", fontSize: 12 }}>Select God</Label>
            <Select
              value={selectedGodId?.toString() ?? ""}
              onValueChange={(v) => { setSelectedGodId(Number(v)); setSelectedInstanceId(null); setLocalGrid(BLANK_GRID()); }}
            >
              <SelectTrigger style={{ width: 200, background: "#111827", border: "1px solid #374151", color: "#e5e7eb" }}>
                <SelectValue placeholder="Choose a god…" />
              </SelectTrigger>
              <SelectContent>
                {gods?.map(g => (
                  <SelectItem key={g.id} value={g.id.toString()}>
                    {g.name} (#{g.id}) — {g.favor} favor
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            disabled={!selectedGodId || stageMut.isPending}
            onClick={handleCreateLair}
            style={{ fontSize: 12, borderColor: "#9333ea", color: "#c084fc" }}
          >
            + Create New Lair
          </Button>
        </div>

        {instances && instances.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Label style={{ color: "#9ca3af", fontSize: 12 }}>Instances</Label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {instances.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => setSelectedInstanceId(inst.id)}
                  style={{
                    background: selectedInstanceId === inst.id ? "#1e1b4b" : "#111827",
                    border: `1px solid ${selectedInstanceId === inst.id ? "#9333ea" : "#374151"}`,
                    borderRadius: 6,
                    padding: "6px 12px",
                    color: selectedInstanceId === inst.id ? "#c084fc" : "#9ca3af",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Lair #{inst.id} {inst.tileDataJson ? "✓" : inst.stagedTileDataJson ? "⏳" : "✗"}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Paint Grid ── */}
      {selectedGodId && (
        <div style={{
          background: "#0d1b2a", border: "1px solid #1e2a3a",
          borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ color: "#fde68a", margin: 0, fontSize: 14 }}>
              Divine Brush {selectedInstanceId ? `— Lair #${selectedInstanceId}` : ""}
            </h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: dCount === 1 ? "#4ade80" : "#f87171" }}>
                D tiles: {dCount} {dCount === 1 ? "✓" : "✗ (need exactly 1)"}
              </span>
              {committedGrid && (
                <span style={{ fontSize: 12, color: "#c084fc" }}>
                  Cost: {favorCost} favor ({changedTiles} changed)
                </span>
              )}
            </div>
          </div>

          {/* Palette */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PALETTE_TILES.map(t => (
              <button
                key={t.char}
                onClick={() => setActiveTile(t.char)}
                style={{
                  background: activeTile === t.char ? t.color : "#111827",
                  border: `2px solid ${activeTile === t.char ? t.color : "#374151"}`,
                  borderRadius: 4,
                  color: activeTile === t.char ? "#fff" : "#9ca3af",
                  cursor: "pointer",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
                title={t.label}
              >
                {t.char} {t.label}
              </button>
            ))}
          </div>

          {/* Grid */}
          <ScrollArea style={{ maxWidth: "100%" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID_SIZE}, 24px)`,
                gridTemplateRows: `repeat(${GRID_SIZE}, 24px)`,
                gap: 1,
                width: GRID_SIZE * 25,
              }}
            >
              {localGrid.map((row, r) =>
                row.map((cell, c) => (
                  <button
                    key={`${r}-${c}`}
                    onClick={() => handleCellClick(r, c)}
                    title={`(${c}, ${r}) = ${cell}`}
                    style={{
                      width: 24,
                      height: 24,
                      background: getTileColor(cell),
                      border: cell === "D" ? "2px solid #c084fc" : "1px solid #1e2a3a",
                      borderRadius: 2,
                      cursor: "pointer",
                      color: "#fff",
                      fontSize: 10,
                      fontFamily: "monospace",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {cell === "D" ? "D" : ""}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button
              variant="outline"
              disabled={!selectedGodId || stageMut.isPending || (selectedInstanceId !== null && dCount !== 1)}
              onClick={selectedInstanceId ? handleSubmitLayout : handleCreateLair}
              style={{
                alignSelf: "flex-start",
                fontSize: 12,
                borderColor: (selectedInstanceId === null || dCount === 1) ? "#4ade80" : "#374151",
                color: (selectedInstanceId === null || dCount === 1) ? "#4ade80" : "#6b7280",
              }}
            >
              {stageMut.isPending ? "Queuing…" : selectedInstanceId ? "Submit Layout Update" : "Create & Submit Layout"}
            </Button>

            {selectedInstanceId && (
              <span style={{
                fontSize: 11,
                color: selectedInstance?.tileDataJson
                  ? "#4ade80"
                  : selectedInstance?.stagedTileDataJson
                  ? "#fbbf24"
                  : "#6b7280",
              }}>
                {selectedInstance?.tileDataJson
                  ? `✓ Committed — ${new Date(selectedInstance.updatedAt).toLocaleTimeString()}`
                  : selectedInstance?.stagedTileDataJson
                  ? "⏳ Staged — awaiting next heartbeat"
                  : "✗ No committed layout"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Section 3: Place Entrance ── */}
      {selectedInstanceId && selectedInstance?.tileDataJson && (
        <div style={{
          background: "#0d1b2a", border: "1px solid #1e2a3a",
          borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12,
        }}>
          <h3 style={{ color: "#fde68a", margin: 0, fontSize: 14 }}>Place Overworld Entrance</h3>

          <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>
            Cost:{" "}
            <span style={{ color: isFirstEntrance ? "#4ade80" : "#c084fc", fontWeight: 600 }}>
              {isFirstEntrance ? "FREE (first placement)" : `${placementCost} favor`}
            </span>
          </p>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label style={{ color: "#9ca3af", fontSize: 12 }}>Overworld Grid X</Label>
              <Input
                type="number"
                value={entranceX}
                onChange={e => setEntranceX(Number(e.target.value))}
                style={{ width: 100, background: "#111827", border: "1px solid #374151", color: "#e5e7eb" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Label style={{ color: "#9ca3af", fontSize: 12 }}>Overworld Grid Y</Label>
              <Input
                type="number"
                value={entranceY}
                onChange={e => setEntranceY(Number(e.target.value))}
                style={{ width: 100, background: "#111827", border: "1px solid #374151", color: "#e5e7eb" }}
              />
            </div>
            <Button
              variant="outline"
              disabled={placeMut.isPending}
              onClick={handlePlaceEntrance}
              style={{ fontSize: 12, borderColor: "#9333ea", color: "#c084fc" }}
            >
              {placeMut.isPending ? "Queuing…" : "Place Entrance"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Feedback ── */}
      {error && (
        <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 12px" }}>
          <span style={{ color: "#f87171", fontSize: 13 }}>⚠ {error}</span>
        </div>
      )}
      {successMsg && (
        <div style={{ background: "#0a1a0a", border: "1px solid #14532d", borderRadius: 6, padding: "8px 12px" }}>
          <span style={{ color: "#4ade80", fontSize: 13 }}>✓ {successMsg}</span>
        </div>
      )}

      {/* ── OPEN_DOOR reference ── */}
      <div style={{
        background: "#0d1117", border: "1px solid #1e2a3a",
        borderRadius: 8, padding: 12, fontSize: 12, color: "#6b7280",
      }}>
        <p style={{ margin: 0 }}>
          <strong style={{ color: "#9ca3af" }}>OPEN_DOOR frog action:</strong>{" "}
          Frogs standing on an overworld "D" tile can queue <code style={{ color: "#c084fc" }}>OPEN_DOOR</code> to enter this lair.
          Inside the lair, standing on the "D" tile and queuing OPEN_DOOR exits back to the overworld.
        </p>
      </div>
    </div>
  );
}
