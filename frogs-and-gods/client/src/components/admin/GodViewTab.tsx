import { useState, useMemo, useEffect } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Viewport } from "@/components/Viewport";
import { ActionLog } from "@/components/ActionLog";
import { useTickSync } from "@/hooks/useTickSync";
import { useActionLogs } from "@/hooks/useActionLogs";
import { spriteManager } from "@/lib/SpriteManager";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TILE_REGISTRY } from "../../../../shared/tileRegistry";
import { DIVINE_POWER_LIST } from "../../../../shared/divinePowers";
import type { TileChar, DivinePowerId } from "../../../../shared/game.schema";

const POWER_TYPE_COLORS: Record<string, string> = {
  BLESSING:      "#34d399",
  CURSE:         "#f87171",
  DIVINE_ABILITY: "#a78bfa",
};

export function GodViewTab() {
  // ── God selector ────────────────────────────────────
  const { data: gods, refetch: refetchGods } = trpc.admin.listGods.useQuery();
  const [selectedGodId, setSelectedGodId] = useState<number | null>(null);
  const selectedGod = useMemo(
    () => gods?.find((g) => g.id === selectedGodId) ?? null,
    [gods, selectedGodId],
  );

  // ── Camera state ─────────────────────────────────────
  const [cameraChunkX, setCameraChunkX] = useState(0);
  const [cameraChunkY, setCameraChunkY] = useState(0);
  const [coordInputX, setCoordInputX] = useState("0");
  const [coordInputY, setCoordInputY] = useState("0");
  const [pendingPan, setPendingPan] = useState<{ chunkX: number; chunkY: number } | null>(null);

  // ── Vision query ─────────────────────────────────────
  const { data: vision, refetch: refetchVision } = trpc.admin.getGodVision.useQuery(
    { centerChunkX: cameraChunkX, centerChunkY: cameraChunkY },
    { placeholderData: keepPreviousData },
  );

  // ── Sprite loading ────────────────────────────────────
  const newItemIds = (vision?.items ?? [])
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

  // ── Entities for Viewport ─────────────────────────────
  const entities = useMemo(() => {
    if (!vision) return [];
    const predatorTiles = vision.predators.flatMap((p) => {
      const stats = p.statsJson as { segments?: { x: number; y: number }[] } | null;
      const head = { gridX: p.gridX, gridY: p.gridY, type: "predator" as const };
      const body = (stats?.segments ?? []).map((s) => ({ gridX: s.x, gridY: s.y, type: "predator" as const }));
      return [head, ...body];
    });
    return [
      ...vision.frogs.map((f) => ({ gridX: f.gridX, gridY: f.gridY, type: "frog" as const })),
      ...predatorTiles,
    ];
  }, [vision]);

  // ── Tile selection ────────────────────────────────────
  const [selectedTile, setSelectedTile] = useState<{ gridX: number; gridY: number } | null>(null);
  const [hoveredTile, setHoveredTile] = useState<{ gridX: number; gridY: number } | null>(null);

  // ── Divine action state ───────────────────────────────
  const [activePower, setActivePower] = useState<DivinePowerId | null>(null);
  const [spawnItemTemplateId, setSpawnItemTemplateId] = useState<string>("");
  const [spawnEnemyType, setSpawnEnemyType] = useState<"SNAKE" | "FLY">("SNAKE");
  const [spawnEnemyAiType, setSpawnEnemyAiType] = useState<"HUNTER" | "REACTIVE" | "DOCILE">("REACTIVE");
  const [spawnEnemyHp, setSpawnEnemyHp] = useState(30);
  const [spawnEnemySpeed, setSpawnEnemySpeed] = useState(3);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Lair placement state ──────────────────────────────
  const [placingLairEntrance, setPlacingLairEntrance] = useState(false);
  const [selectedLairInstanceId, setSelectedLairInstanceId] = useState<number | null>(null);
  const [lairActionMsg, setLairActionMsg] = useState<string | null>(null);

  const { data: allItems } = trpc.admin.listItems.useQuery();

  // ── Lair queries + mutation ───────────────────────────
  const { data: lairInstances } = trpc.admin.getLairsByGod.useQuery(
    { godId: selectedGodId! },
    { enabled: selectedGodId !== null },
  );
  const { data: lairEntranceCount } = trpc.admin.getLairEntranceCountForGod.useQuery(
    { godId: selectedGodId! },
    { enabled: selectedGodId !== null },
  );
  const submitPlaceLair = trpc.admin.submitDivPlaceLair.useMutation({
    onSuccess: (data) => {
      setPlacingLairEntrance(false);
      setHoveredTile(null);
      setLairActionMsg(`Entrance queued (action #${data.pendingActionId}). Resolves next heartbeat.`);
      setActionError(null);
    },
    onError: (err) => {
      setPlacingLairEntrance(false);
      setActionError(err.message);
    },
  });

  // ── Action log ────────────────────────────────────────
  const { actionLogs } = useActionLogs(cameraChunkX * 16, cameraChunkY * 16);

  // ── Tick sync ─────────────────────────────────────────
  useTickSync(() => {
    if (pendingPan) {
      setCameraChunkX(pendingPan.chunkX);
      setCameraChunkY(pendingPan.chunkY);
      setCoordInputX(String(pendingPan.chunkX));
      setCoordInputY(String(pendingPan.chunkY));
      setPendingPan(null);
    }
    void refetchVision();
    void refetchGods();
  });

  // ── Mutations ─────────────────────────────────────────
  const submitDivineAction = trpc.admin.submitDivineAction.useMutation({
    onSuccess: () => {
      setActivePower(null);
      setSelectedTile(null);
      setActionError(null);
      void refetchGods();
    },
    onError: (err) => {
      setActionError(err.message);
      setActivePower(null);
    },
  });

  const submitGodPan = trpc.admin.submitGodPan.useMutation({
    onError: (err) => setActionError(err.message),
  });

  // ── Look panel ────────────────────────────────────────
  const lookData = useMemo(() => {
    if (!selectedTile || !vision) return null;
    const { gridX, gridY } = selectedTile;
    const chunkX = Math.floor(gridX / 16);
    const chunkY = Math.floor(gridY / 16);
    const localX = ((gridX % 16) + 16) % 16;
    const localY = ((gridY % 16) + 16) % 16;
    const tileGrid = vision.chunks[`${chunkX}:${chunkY}`];
    const tileChar = tileGrid?.[localY]?.[localX] ?? null;
    const tileDef = tileChar ? TILE_REGISTRY[tileChar as TileChar] : null;
    return {
      gridX, gridY, tileChar, tileDef,
      frogsHere:     vision.frogs.filter((f) => f.gridX === gridX && f.gridY === gridY),
      predatorsHere: vision.predators.filter((p) => p.gridX === gridX && p.gridY === gridY),
      itemsHere:     vision.items.filter((i) => i.gridX === gridX && i.gridY === gridY),
    };
  }, [selectedTile, vision]);

  // ── Tile click routing ────────────────────────────────
  function handleTileClick(gridX: number, gridY: number) {
    setActionError(null);
    if (placingLairEntrance) {
      if (!selectedGodId || !selectedLairInstanceId) { setActionError("Select an instance first."); return; }
      submitPlaceLair.mutate({ godId: selectedGodId, instanceId: selectedLairInstanceId, targetGridX: gridX, targetGridY: gridY });
      return;
    }
    if (activePower) {
      handleDivineTileClick(gridX, gridY);
      return;
    }
    const clickedCX = Math.floor(gridX / 16);
    const clickedCY = Math.floor(gridY / 16);
    const dx = clickedCX - cameraChunkX;
    const dy = clickedCY - cameraChunkY;
    const isNeighbor = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && !(dx === 0 && dy === 0);
    if (isNeighbor && selectedGodId !== null) {
      setPendingPan({ chunkX: clickedCX, chunkY: clickedCY });
      submitGodPan.mutate({ godId: selectedGodId, chunkX: clickedCX, chunkY: clickedCY });
    } else {
      setSelectedTile({ gridX, gridY });
    }
  }

  function handleDivineTileClick(gridX: number, gridY: number) {
    if (!activePower || selectedGodId === null) return;
    if (activePower === "HEAL_FROG") {
      const frog = vision?.frogs.find((f) => f.gridX === gridX && f.gridY === gridY);
      if (!frog) { setActionError("No frog at that tile."); return; }
      submitDivineAction.mutate({ godId: selectedGodId, powerId: "HEAL_FROG", targetGridX: gridX, targetGridY: gridY, targetFrogId: frog.id });
    } else if (activePower === "SMITE_ENEMY") {
      const pred = vision?.predators.find((p) => p.gridX === gridX && p.gridY === gridY);
      if (!pred) { setActionError("No enemy at that tile."); return; }
      submitDivineAction.mutate({ godId: selectedGodId, powerId: "SMITE_ENEMY", targetGridX: gridX, targetGridY: gridY, targetPredatorId: pred.id });
    } else if (activePower === "SPAWN_ITEM") {
      if (!spawnItemTemplateId) { setActionError("Select an item template first."); return; }
      submitDivineAction.mutate({ godId: selectedGodId, powerId: "SPAWN_ITEM", targetGridX: gridX, targetGridY: gridY, spawnItemTemplateId });
    } else if (activePower === "SPAWN_PREDATOR") {
      submitDivineAction.mutate({
        godId: selectedGodId, powerId: "SPAWN_PREDATOR",
        targetGridX: gridX, targetGridY: gridY,
        spawnEnemyType, spawnEnemyAiType, spawnEnemyHp, spawnEnemySpeed,
      });
    }
  }

  function handleInstantTeleport() {
    const x = parseInt(coordInputX, 10);
    const y = parseInt(coordInputY, 10);
    if (!isNaN(x) && !isNaN(y)) {
      setCameraChunkX(x);
      setCameraChunkY(y);
    }
  }

  const godFavor = selectedGod?.favor ?? 0;
  const powers = (selectedGod?.startingPowers ?? []) as string[];
  const canAct = selectedGodId !== null && !submitDivineAction.isPending;

  // ── Render ────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, whiteSpace: "nowrap" }}>
          God
        </p>
        <Select
          value={selectedGodId?.toString() ?? ""}
          onValueChange={(v) => { setSelectedGodId(Number(v)); setActivePower(null); setSelectedTile(null); setPlacingLairEntrance(false); setSelectedLairInstanceId(null); setLairActionMsg(null); }}
        >
          <SelectTrigger style={{ width: 260, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", fontSize: 12 }}>
            <SelectValue placeholder="— select a god —" />
          </SelectTrigger>
          <SelectContent style={{ background: "#0a1120", border: "1px solid #1e2a3a" }}>
            {(gods ?? []).map((g) => (
              <SelectItem key={g.id} value={g.id.toString()} style={{ fontSize: 12, color: "#e2e8f0" }}>
                {g.name} · {g.favor}♦
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedGod && (
          <p style={{ fontSize: 11, color: "#fde68a", margin: 0 }}>
            Favor: <strong>{selectedGod.favor}</strong>
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Chunk:</p>
          <Input
            value={coordInputX}
            onChange={(e) => setCoordInputX(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleInstantTeleport(); }}
            style={{ width: 56, fontSize: 12, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", padding: "4px 8px", height: 28 }}
          />
          <Input
            value={coordInputY}
            onChange={(e) => setCoordInputY(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleInstantTeleport(); }}
            style={{ width: 56, fontSize: 12, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", padding: "4px 8px", height: 28 }}
          />
          <button
            onClick={handleInstantTeleport}
            style={{ fontSize: 11, padding: "4px 10px", background: "#0f1929", border: "1px solid #1e2a3a", color: "#60a5fa", borderRadius: 4, cursor: "pointer" }}
          >
            Go
          </button>
          <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>
            (click outer chunk to queue pan)
          </p>
        </div>
      </div>

      {/* Pending pan indicator */}
      {pendingPan && (
        <p style={{ fontSize: 11, color: "#a78bfa", margin: 0 }}>
          ↷ Pan queued to chunk ({pendingPan.chunkX}, {pendingPan.chunkY}) — applying on next tick
        </p>
      )}

      {/* Canvas + Look panel */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        <div style={{ flexShrink: 0 }}>
          <Viewport
            centerChunkX={cameraChunkX}
            centerChunkY={cameraChunkY}
            chunks={vision?.chunks ?? {}}
            entities={entities}
            groundItems={(vision?.items ?? [])
              .filter((i) => i.gridX != null && i.gridY != null)
              .map((i) => ({ gridX: i.gridX!, gridY: i.gridY!, itemId: i.itemId }))}
            selectedTile={(activePower || placingLairEntrance) ? undefined : (selectedTile ?? undefined)}
            onTileClick={handleTileClick}
            hoveredTargetTile={(activePower || placingLairEntrance) ? (hoveredTile ?? undefined) : undefined}
            onTileHover={(activePower || placingLairEntrance) ? (gx, gy) => setHoveredTile({ gridX: gx, gridY: gy }) : undefined}
            onTileRightClick={(activePower || placingLairEntrance) ? () => { setActivePower(null); setPlacingLairEntrance(false); setHoveredTile(null); } : undefined}
          />
        </div>

        {/* Look panel */}
        <div style={{ flex: 1, minWidth: 220, background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: "14px 16px", fontFamily: "monospace", minHeight: 420 }}>
          <p style={{ fontSize: 10, color: "#6b7280", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
            Look
          </p>
          {!lookData ? (
            <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>
              {activePower ? "Click a tile to target." : "Click a tile to inspect."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 11, color: "#facc15", margin: 0 }}>
                ({lookData.gridX}, {lookData.gridY})
              </p>
              <div>
                <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Terrain</p>
                {lookData.tileDef ? (
                  <>
                    <p style={{ fontSize: 13, color: lookData.tileDef.color, margin: 0 }}>
                      {lookData.tileChar} {lookData.tileDef.label}
                    </p>
                    <p style={{ fontSize: 11, color: "#4b5563", margin: "2px 0 0" }}>
                      move cost: {lookData.tileDef.movementCost}
                    </p>
                  </>
                ) : (
                  <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>Unknown tile</p>
                )}
              </div>
              <div>
                <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Frogs</p>
                {lookData.frogsHere.length === 0
                  ? <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>—</p>
                  : lookData.frogsHere.map((f) => (
                    <p key={f.id} style={{ fontSize: 11, color: "#00ff88", margin: "2px 0" }}>
                      ▸ {f.name} · Lv{f.level} · HP {f.currentHp}/{f.statsJson.maxHp}{f.isDead ? " ☠" : ""}
                    </p>
                  ))}
              </div>
              <div>
                <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Predators</p>
                {lookData.predatorsHere.length === 0
                  ? <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>—</p>
                  : lookData.predatorsHere.map((p) => (
                    <p key={p.id} style={{ fontSize: 11, color: "#ff4444", margin: "2px 0" }}>
                      ▸ {p.enemyType} ({p.aiType}) · HP {p.currentHp}
                    </p>
                  ))}
              </div>
              <div>
                <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Loot</p>
                {lookData.itemsHere.length === 0
                  ? <p style={{ fontSize: 11, color: "#374151", margin: 0 }}>—</p>
                  : lookData.itemsHere.map((item) => (
                    <p key={item.itemId} style={{ fontSize: 11, color: "#fde68a", margin: "2px 0" }}>
                      ▸ {item.name} (T{item.rarityTier})
                    </p>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Divine Action Bar */}
      <div style={{ background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: "14px 16px" }}>
        <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
          Divine Powers
        </p>

        {!selectedGodId ? (
          <p style={{ fontSize: 11, color: "#374151" }}>Select a god to see their powers.</p>
        ) : powers.length === 0 ? (
          <p style={{ fontSize: 11, color: "#374151" }}>This god has no starting powers.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {DIVINE_POWER_LIST.filter((p) => powers.includes(p.id)).map((power) => {
                const isActive = activePower === power.id;
                const color = POWER_TYPE_COLORS[power.type] ?? "#9ca3af";
                const disabled = !canAct || godFavor < 25;
                return (
                  <button
                    key={power.id}
                    disabled={disabled}
                    onClick={() => {
                      setActivePower(isActive ? null : power.id as DivinePowerId);
                      setActionError(null);
                      setHoveredTile(null);
                    }}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      fontFamily: "monospace",
                      background: isActive ? "#1a1040" : "#0f1929",
                      border: `1px solid ${isActive ? color : "#1e2a3a"}`,
                      borderRadius: 6,
                      color: disabled ? "#374151" : color,
                      cursor: disabled ? "not-allowed" : "pointer",
                      transition: "border-color 0.15s",
                    }}
                  >
                    {power.name}
                    <span style={{ marginLeft: 8, fontSize: 10, color: "#6b7280" }}>-25♦</span>
                  </button>
                );
              })}
            </div>

            {/* Targeting prompt */}
            {activePower && (
              <p style={{ fontSize: 11, color: "#a78bfa", marginBottom: 8 }}>
                {activePower === "HEAL_FROG" && "Click a tile with a frog to heal it."}
                {activePower === "SMITE_ENEMY" && "Click a tile with an enemy to smite it."}
                {activePower === "SPAWN_ITEM" && "Select an item below, then click a tile to place it."}
                {activePower === "SPAWN_PREDATOR" && "Configure the enemy below, then click a tile to spawn it."}
                {" "}Right-click canvas to cancel.
              </p>
            )}

            {/* SPAWN_ITEM inline form */}
            {activePower === "SPAWN_ITEM" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Item:</p>
                <Select value={spawnItemTemplateId} onValueChange={setSpawnItemTemplateId}>
                  <SelectTrigger style={{ width: 280, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", fontSize: 12, height: 30 }}>
                    <SelectValue placeholder="— choose item —" />
                  </SelectTrigger>
                  <SelectContent style={{ background: "#0a1120", border: "1px solid #1e2a3a" }}>
                    {(allItems ?? []).map((item) => (
                      <SelectItem key={item.itemId} value={item.itemId} style={{ fontSize: 12, color: "#e2e8f0" }}>
                        {item.name} (T{item.rarityTier})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* SPAWN_PREDATOR inline form */}
            {activePower === "SPAWN_PREDATOR" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Type:</p>
                  <Select value={spawnEnemyType} onValueChange={(v) => setSpawnEnemyType(v as "SNAKE" | "FLY")}>
                    <SelectTrigger style={{ width: 100, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", fontSize: 12, height: 30 }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: "#0a1120", border: "1px solid #1e2a3a" }}>
                      <SelectItem value="SNAKE" style={{ fontSize: 12, color: "#e2e8f0" }}>SNAKE</SelectItem>
                      <SelectItem value="FLY" style={{ fontSize: 12, color: "#e2e8f0" }}>FLY</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>AI:</p>
                  <Select value={spawnEnemyAiType} onValueChange={(v) => setSpawnEnemyAiType(v as "HUNTER" | "REACTIVE" | "DOCILE")}>
                    <SelectTrigger style={{ width: 110, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", fontSize: 12, height: 30 }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ background: "#0a1120", border: "1px solid #1e2a3a" }}>
                      <SelectItem value="HUNTER" style={{ fontSize: 12, color: "#e2e8f0" }}>HUNTER</SelectItem>
                      <SelectItem value="REACTIVE" style={{ fontSize: 12, color: "#e2e8f0" }}>REACTIVE</SelectItem>
                      <SelectItem value="DOCILE" style={{ fontSize: 12, color: "#e2e8f0" }}>DOCILE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>HP:</p>
                  <Input
                    type="number" min={1} max={500} value={spawnEnemyHp}
                    onChange={(e) => setSpawnEnemyHp(parseInt(e.target.value, 10) || 30)}
                    style={{ width: 60, fontSize: 12, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", padding: "2px 8px", height: 30 }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Spd:</p>
                  <Input
                    type="number" min={1} max={10} value={spawnEnemySpeed}
                    onChange={(e) => setSpawnEnemySpeed(parseInt(e.target.value, 10) || 3)}
                    style={{ width: 56, fontSize: 12, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", padding: "2px 8px", height: 30 }}
                  />
                </div>
              </div>
            )}

            {actionError && (
              <p style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{actionError}</p>
            )}
            {godFavor < 25 && selectedGodId && (
              <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>No favor remaining — use the Gods tab to restore.</p>
            )}
          </>
        )}
      </div>

      {/* Lair Actions */}
      {selectedGodId && (
        <div style={{ background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: "14px 16px" }}>
          <p style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
            Lair Actions
          </p>
          {(!lairInstances || lairInstances.filter(i => i.tileDataJson !== null).length === 0) ? (
            <p style={{ fontSize: 11, color: "#374151" }}>
              No committed lairs yet — use the God's Lair tab to design and submit a layout first.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>Instance:</p>
                <Select
                  value={selectedLairInstanceId?.toString() ?? ""}
                  onValueChange={(v) => { setSelectedLairInstanceId(Number(v)); setLairActionMsg(null); }}
                >
                  <SelectTrigger style={{ width: 180, background: "#0a1120", border: "1px solid #1e2a3a", color: "#e2e8f0", fontSize: 12, height: 30 }}>
                    <SelectValue placeholder="— choose lair —" />
                  </SelectTrigger>
                  <SelectContent style={{ background: "#0a1120", border: "1px solid #1e2a3a" }}>
                    {lairInstances.filter(i => i.tileDataJson !== null).map(inst => (
                      <SelectItem key={inst.id} value={inst.id.toString()} style={{ fontSize: 12, color: "#e2e8f0" }}>
                        Lair #{inst.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <button
                  disabled={!selectedLairInstanceId || submitPlaceLair.isPending}
                  onClick={() => {
                    setPlacingLairEntrance(prev => !prev);
                    setActivePower(null);
                    setActionError(null);
                    setLairActionMsg(null);
                    setHoveredTile(null);
                  }}
                  style={{
                    padding: "5px 14px",
                    fontSize: 12,
                    fontFamily: "monospace",
                    background: placingLairEntrance ? "#160b2e" : "#0f1929",
                    border: `1px solid ${placingLairEntrance ? "#9333ea" : "#1e2a3a"}`,
                    borderRadius: 6,
                    color: !selectedLairInstanceId ? "#374151" : placingLairEntrance ? "#c084fc" : "#9ca3af",
                    cursor: !selectedLairInstanceId ? "not-allowed" : "pointer",
                  }}
                >
                  {placingLairEntrance ? "Cancel" : "Place Entrance"}
                  <span style={{ marginLeft: 8, fontSize: 10, color: "#6b7280" }}>
                    {(lairEntranceCount?.count ?? 0) === 0 ? "FREE" : "-50♦"}
                  </span>
                </button>
              </div>

              {placingLairEntrance && (
                <p style={{ fontSize: 11, color: "#a78bfa", margin: "0 0 6px" }}>
                  Click a tile on the map to anchor this lair's entrance there. Right-click to cancel.
                </p>
              )}
              {lairActionMsg && (
                <p style={{ fontSize: 11, color: "#4ade80", margin: 0 }}>{lairActionMsg}</p>
              )}
            </>
          )}
        </div>
      )}

      <ActionLog logs={actionLogs} />
    </div>
  );
}
