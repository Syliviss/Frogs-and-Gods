import { chebyshevDistance, OPEN_WATER_TILES } from "../../../shared/movement";
import type { TileDef } from "../../../shared/tileRegistry";
import type { ActionSchema, TileChar } from "../../../shared/game.schema";

export interface EquippedActionEntry {
  actionName:    string;
  itemId:        string;
  itemName:      string;
  actionSchema?: ActionSchema | null;
}

interface ActionBarProps {
  selectedTile:    { gridX: number; gridY: number } | null;
  playerFrog:      { gridX: number; gridY: number } | null;
  lockedIn:        boolean;
  equippedActions: EquippedActionEntry[];
  targetingMode?:  boolean;
  playerTileChar?: TileChar | null;
  onMove:          (actionType: "STEP" | "HOP" | "SWIM") => void;
  onAction:        (actionName: string, itemId: string, actionSchema?: ActionSchema | null) => void;
  onPickup?:       () => void;
  onCroak?:        () => void;
  onOpenDoor?:     () => void;
  onCancelTarget?: () => void;
  error?:          string | null;
  tileDef?:        TileDef | null;
  lairInstanceId?: number | null;
}

export function ActionBar({
  selectedTile,
  playerFrog,
  lockedIn,
  equippedActions,
  targetingMode,
  playerTileChar,
  onMove,
  onAction,
  onPickup  = () => {},
  onCroak,
  onOpenDoor,
  onCancelTarget,
  error,
  tileDef,
  lairInstanceId,
}: ActionBarProps) {

  const isInOpenWater = playerTileChar != null && OPEN_WATER_TILES.has(playerTileChar);

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

  if (targetingMode) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="text-sm text-red-400 font-serif animate-pulse">
          Select target tiles — right-click or Escape to cancel
        </div>
        {onCancelTarget && (
          <button
            onClick={onCancelTarget}
            className="px-4 py-1.5 border border-red-800 rounded text-xs font-bold font-serif hover:bg-red-900/40 transition"
          >
            Cancel
          </button>
        )}
        {error && <p className="text-red-400 text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {selectedTile ? (
        <div className="text-xs text-gray-400">
          <span>({selectedTile.gridX}, {selectedTile.gridY})</span>
          {tileDef && <span className="ml-2" style={{ color: tileDef.color }}>{tileDef.label}</span>}
          {lairInstanceId != null && <span className="ml-2 text-purple-400">Lair #{lairInstanceId}</span>}
          {dist !== null && <span className="ml-2 text-gray-600">dist {dist}</span>}
        </div>
      ) : (
        <p className="text-sm text-gray-600 font-serif">Click a tile to select a destination.</p>
      )}

      {/* Universal movement actions */}
      <div className="flex gap-3 flex-wrap justify-center">
        {!isInOpenWater && (
          <button
            onClick={() => onMove("STEP")}
            className="px-5 py-2 border border-amber-700 rounded text-sm font-bold font-serif hover:bg-amber-900/40 transition"
          >
            STEP <span className="text-gray-500 text-xs font-normal">(≤1)</span>
          </button>
        )}
        {isInOpenWater ? (
          <button
            onClick={() => onMove("SWIM")}
            className="px-5 py-2 border border-blue-600 rounded text-sm font-bold font-serif hover:bg-blue-900/40 transition"
          >
            SWIM <span className="text-gray-500 text-xs font-normal">(straight)</span>
          </button>
        ) : (
          <button
            onClick={() => onMove("HOP")}
            className="px-5 py-2 border border-amber-700 rounded text-sm font-bold font-serif hover:bg-amber-900/40 transition"
          >
            HOP <span className="text-gray-500 text-xs font-normal">(≤3)</span>
          </button>
        )}
        <button
          onClick={() => onAction("THROW", "", null)}
          className="px-5 py-2 border border-blue-800 rounded text-sm font-bold font-serif hover:bg-blue-900/40 transition"
        >
          THROW <span className="text-gray-500 text-xs font-normal">(≤3)</span>
        </button>

        <button
          onClick={() => onPickup()}
          className="px-5 py-2 border border-green-700 rounded text-sm font-bold font-serif hover:bg-green-900/40 transition"
        >
          PICKUP
        </button>
        <button
          onClick={() => onCroak?.()}
          className="px-5 py-2 border border-teal-700 rounded text-sm font-bold font-serif hover:bg-teal-900/40 transition"
        >
          CROAK
        </button>
        {onOpenDoor && (
          <button
            onClick={onOpenDoor}
            className="px-5 py-2 border border-purple-700 rounded text-sm font-bold font-serif hover:bg-purple-900/40 transition"
          >
            OPEN DOOR
          </button>
        )}
      </div>

      {/* Divider — only shown when item-granted actions are present */}
      {equippedActions.length > 0 && (
        <div className="flex items-center gap-2 w-full">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600 uppercase tracking-widest">equipped</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>
      )}

      {/* Item-granted actions — schema-driven; refreshed on each ENGINE_TICK */}
      {equippedActions.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center mt-1">
          {equippedActions.map((entry) => {
            const isFlingConsume = entry.actionName === "FLING_CONSUME";
            const isFling        = entry.actionName === "FLING" || isFlingConsume;
            return (
              <button
                key={`${entry.itemId}-${entry.actionName}`}
                onClick={() => onAction(entry.actionName, entry.itemId, entry.actionSchema)}
                className={`px-4 py-1.5 border rounded text-xs font-bold font-serif transition flex flex-col items-center leading-tight ${
                  isFlingConsume
                    ? "border-red-700 hover:bg-red-900/40"
                    : "border-purple-700 hover:bg-purple-900/40"
                }`}
              >
                {isFling ? (
                  <>
                    <span>Fling ({entry.itemName})</span>
                    {isFlingConsume && <span className="text-red-400 text-[10px] font-normal">CONSUMED</span>}
                  </>
                ) : (
                  <span>
                    {entry.actionName}
                    {entry.actionSchema && (
                      <span className="text-gray-500 text-xs font-normal ml-1">
                        ({entry.actionSchema.cast_time_ms / 1000}s)
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
