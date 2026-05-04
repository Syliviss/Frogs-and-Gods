import { useState, useEffect } from "react";
import { Viewport } from "@/components/Viewport";
import { ActionBar } from "@/components/ActionBar";
import { trpc } from "@/lib/trpc";
import { useTickSync } from "@/hooks/useTickSync";
import { getTileDef } from "../../../shared/tileRegistry";

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

  const submitMovement = trpc.admin.submitMovementForFrog.useMutation({
    onSuccess: () => setLockedIn(true),
  });

  useTickSync(() => {
    // Pull position directly from the refetch response so centering updates
    // in the same state batch as the vision data, without a second render cycle.
    void visionQuery.refetch().then(result => {
      if (!result.data || !selectedFrogId) return;
      const vf = result.data.frogs.find(f => f.id === selectedFrogId);
      if (vf) setFrogPos({ gridX: vf.gridX, gridY: vf.gridY });
    });
    void frogsQuery.refetch();
    setLockedIn(false);
  });

  const effectivePos = frogPos ?? playerFrog;
  const centerChunkX = effectivePos ? Math.floor(effectivePos.gridX / CHUNK_SIZE) : 0;
  const centerChunkY = effectivePos ? Math.floor(effectivePos.gridY / CHUNK_SIZE) : 0;

  const entities = [
    ...(vision?.frogs ?? []).map(f => ({ gridX: f.gridX, gridY: f.gridY, type: "frog" as const })),
    ...(vision?.predators ?? []).map(p => ({ gridX: p.gridX, gridY: p.gridY, type: "predator" as const })),
  ];

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
        selectedTile={selectedTile ?? undefined}
        onTileClick={(gridX, gridY) => setSelectedTile({ gridX, gridY })}
      />

      <ActionBar
        selectedTile={selectedTile}
        playerFrog={frogPos ?? playerFrog}
        lockedIn={lockedIn}
        onMove={handleMove}
        error={submitMovement.error?.message}
        tileDef={tileDef}
      />
    </div>
  );
}
