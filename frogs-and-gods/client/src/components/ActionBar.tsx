import { chebyshevDistance } from "../../../shared/movement";
import type { TileDef } from "../../../shared/tileRegistry";

interface ActionBarProps {
  selectedTile: { gridX: number; gridY: number } | null;
  playerFrog:   { gridX: number; gridY: number } | null;
  lockedIn:     boolean;
  onMove:       (actionType: "STEP" | "HOP") => void;
  error?:       string | null;
  tileDef?:     TileDef | null;
}

export function ActionBar({ selectedTile, playerFrog, lockedIn, onMove, error, tileDef }: ActionBarProps) {
  const dist = playerFrog && selectedTile
    ? chebyshevDistance(playerFrog.gridX, playerFrog.gridY, selectedTile.gridX, selectedTile.gridY)
    : null;

  if (lockedIn) {
    return (
      <div className="flex items-center gap-2 text-amber-500 animate-pulse py-2">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-serif">Action Locked In... Waiting for Heartbeat.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {selectedTile ? (
        <div className="text-xs text-gray-400">
          <span>({selectedTile.gridX}, {selectedTile.gridY})</span>
          {tileDef && <span className="ml-2" style={{ color: tileDef.color }}>{tileDef.label}</span>}
          {dist !== null && <span className="ml-2 text-gray-600">dist {dist}</span>}
        </div>
      ) : (
        <p className="text-sm text-gray-600 font-serif">Click a tile to select a destination.</p>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => onMove("STEP")}
          className="px-5 py-2 border border-amber-700 rounded text-sm font-bold font-serif hover:bg-amber-900/40 transition"
        >
          STEP <span className="text-gray-500 text-xs font-normal">(≤1)</span>
        </button>
        <button
          onClick={() => onMove("HOP")}
          className="px-5 py-2 border border-amber-700 rounded text-sm font-bold font-serif hover:bg-amber-900/40 transition"
        >
          HOP <span className="text-gray-500 text-xs font-normal">(≤3)</span>
        </button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
