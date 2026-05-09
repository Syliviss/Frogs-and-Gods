import { useState, useEffect, useMemo } from "react";
import { Viewport } from "@/components/Viewport";
import { ActionBar } from "@/components/ActionBar";
import { ActionLog } from "@/components/ActionLog";
import { trpc } from "@/lib/trpc";
import { useTickSync } from "@/hooks/useTickSync";
import { useActionLogs } from "@/hooks/useActionLogs";
import { useItemIntentBuilder } from "@/hooks/useItemIntentBuilder";
import { getTileDef } from "../../../shared/tileRegistry";
import { spriteManager } from "@/lib/SpriteManager";
import type { ActionSchema } from "../../../shared/game.schema";

const CHUNK_SIZE = 16;

export default function GamePage() {
  const [selectedFrogId, setSelectedFrogId] = useState<number | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ gridX: number; gridY: number } | null>(null);
  const [lockedIn, setLockedIn] = useState(false);
  const [frogPos, setFrogPos] = useState<{ gridX: number; gridY: number } | null>(null);

  const frogsQuery = trpc.admin.listFrogs.useQuery();
  const { data: frogs = [] } = frogsQuery;
  const playerFrog = frogs.find(f => f.id === selectedFrogId) ?? null;

  const visionQuery = trpc.frog.getPlayerVision.useQuery(
    { frogId: selectedFrogId! },
    { enabled: !!selectedFrogId },
  );
  const vision = visionQuery.data;

  // Initialize frogPos from vision on first load so the map centers on selection.
  useEffect(() => {
    if (!vision || !selectedFrogId || frogPos) return;
    const vf = vision.frogs.find(f => f.id === selectedFrogId);
    if (vf) setFrogPos({ gridX: vf.gridX, gridY: vf.gridY });
  }, [vision, selectedFrogId, frogPos]);

  const equippedActionsQuery = trpc.frog.getEquippedActions.useQuery(
    { frogId: selectedFrogId! },
    { enabled: !!selectedFrogId },
  );

  const inventoryQuery = trpc.admin.getInventoryForFrog.useQuery(
    { frogId: selectedFrogId! },
    { enabled: !!selectedFrogId },
  );

  const submitMovement = trpc.admin.submitMovementForFrog.useMutation({
    onSuccess: () => setLockedIn(true),
  });

  // ── Generic Intent Builder ──────────────────────────────────────────────
  const intentBuilder = useItemIntentBuilder({
    frogId:    selectedFrogId,
    frogPos:   frogPos ?? playerFrog,
    onSuccess: () => setLockedIn(true),
  });

  // Stable reference for Viewport dep-array (avoids spurious redraws)
  const targetingTiles = useMemo(
    () => intentBuilder.selectedTiles,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intentBuilder.selectedTiles],
  );

  // Lazy sprite fetch: only request pixel data for item IDs not yet in the cache
  const newItemIds = (vision?.items ?? [])
    .map(i => i.itemId)
    .filter(id => !spriteManager.has(id));

  const pixelDataQuery = trpc.frog.getItemPixelData.useQuery(
    { itemIds: newItemIds },
    { enabled: newItemIds.length > 0 },
  );

  useEffect(() => {
    if (!pixelDataQuery.data) return;
    for (const { itemId, pixelData } of pixelDataQuery.data) {
      if (pixelData) spriteManager.bake(itemId, pixelData);
    }
  }, [pixelDataQuery.data]);

  useTickSync(() => {
    void visionQuery.refetch().then(result => {
      if (!result.data || !selectedFrogId) return;
      const vf = result.data.frogs.find(f => f.id === selectedFrogId);
      if (vf) setFrogPos({ gridX: vf.gridX, gridY: vf.gridY });
      const groundIds = (result.data.items ?? []).map(i => i.itemId);
      const heldIds   = (inventoryQuery.data ?? []).map(i => i.itemId);
      spriteManager.prune(new Set([...groundIds, ...heldIds]));
    });
    void frogsQuery.refetch();
    void equippedActionsQuery.refetch();
    void inventoryQuery.refetch();
    setLockedIn(false);
  });

  const { actionLogs } = useActionLogs(
    frogPos?.gridX ?? playerFrog?.gridX ?? null,
    frogPos?.gridY ?? playerFrog?.gridY ?? null,
  );

  const effectivePos = frogPos ?? playerFrog;
  const centerChunkX = effectivePos ? Math.floor(effectivePos.gridX / CHUNK_SIZE) : 0;
  const centerChunkY = effectivePos ? Math.floor(effectivePos.gridY / CHUNK_SIZE) : 0;

  const entities = [
    ...(vision?.frogs ?? []).map(f => ({ gridX: f.gridX, gridY: f.gridY, type: "frog" as const })),
    ...(vision?.predators ?? []).map(p => ({ gridX: p.gridX, gridY: p.gridY, type: "predator" as const })),
  ];

  const groundItems = (vision?.items ?? [])
    .filter(i => i.itemState === "GROUND" && i.gridX != null && i.gridY != null)
    .map(i => ({ gridX: i.gridX!, gridY: i.gridY!, itemId: i.itemId }));

  const targetChar = selectedTile
    ? vision?.chunks[`${Math.floor(selectedTile.gridX / CHUNK_SIZE)}:${Math.floor(selectedTile.gridY / CHUNK_SIZE)}`]
        ?.[((selectedTile.gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE]
        ?.[((selectedTile.gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE]
    : undefined;
  const tileDef = targetChar ? getTileDef(targetChar) : undefined;

  const handleMove = (actionType: "STEP" | "HOP") => {
    if (!selectedFrogId || !selectedTile) return;
    submitMovement.mutate({
      frogId:      selectedFrogId,
      actionType,
      targetGridX: selectedTile.gridX,
      targetGridY: selectedTile.gridY,
    });
  };

  const handleAction = (actionName: string, _itemId: string, actionSchema?: ActionSchema | null) => {
    if (actionSchema) {
      // Schema-driven action: enter the Generic Intent Builder targeting flow
      intentBuilder.startTargeting(_itemId, actionSchema);
    } else {
      // Legacy stub for simple (non-schema) actions
      setLockedIn(true);
    }
  };

  if (!selectedFrogId) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4 text-amber-200 font-serif">
        <h1 className="text-2xl">Choose Your Frog</h1>
        {frogs.length === 0
          ? <p className="text-gray-500">No frogs found. Create one first.</p>
          : frogs.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFrogId(f.id)}
                className="px-6 py-2 border border-amber-700 rounded hover:bg-amber-900/40 transition"
              >
                {f.name} <span className="text-gray-400 text-sm">(HP {f.currentHp})</span>
              </button>
            ))
        }
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-3 text-amber-200 font-serif">
      <div className="flex gap-6 text-sm text-amber-400">
        <span className="font-bold">{playerFrog?.name ?? "..."}</span>
        <span>HP {playerFrog?.currentHp ?? "—"}</span>
        <span>DEX {(playerFrog?.statsJson as any)?.dex ?? "—"}</span>
        <span className="text-gray-500">({frogPos?.gridX ?? playerFrog?.gridX ?? 0}, {frogPos?.gridY ?? playerFrog?.gridY ?? 0})</span>
        <button
          onClick={() => { setSelectedFrogId(null); setSelectedTile(null); setLockedIn(false); setFrogPos(null); }}
          className="text-gray-600 hover:text-gray-400 text-xs ml-4"
        >
          ← switch frog
        </button>
      </div>

      <Viewport
        centerChunkX={centerChunkX}
        centerChunkY={centerChunkY}
        chunks={vision?.chunks ?? {}}
        entities={entities}
        groundItems={groundItems}
        selectedTile={intentBuilder.mode === "TARGETING" ? undefined : (selectedTile ?? undefined)}
        onTileClick={(gridX, gridY) => {
          if (intentBuilder.mode === "TARGETING") {
            intentBuilder.handleTileClick(gridX, gridY);
          } else {
            setSelectedTile({ gridX, gridY });
          }
        }}
        targetingTiles={intentBuilder.mode === "TARGETING" ? targetingTiles : undefined}
        hoveredTargetTile={intentBuilder.mode === "TARGETING" ? (intentBuilder.hoveredTile ?? undefined) : undefined}
        onTileHover={intentBuilder.mode === "TARGETING" ? intentBuilder.handleTileHover : undefined}
        onTileRightClick={intentBuilder.mode === "TARGETING" ? intentBuilder.cancel : undefined}
      />

      <ActionLog logs={actionLogs} />

      <ActionBar
        selectedTile={selectedTile}
        playerFrog={frogPos ?? playerFrog}
        lockedIn={lockedIn}
        equippedActions={equippedActionsQuery.data ?? []}
        targetingMode={intentBuilder.mode === "TARGETING"}
        onMove={handleMove}
        onAction={handleAction}
        onCancelTarget={intentBuilder.cancel}
        error={submitMovement.error?.message ?? intentBuilder.error}
        tileDef={tileDef}
      />
    </div>
  );
}
