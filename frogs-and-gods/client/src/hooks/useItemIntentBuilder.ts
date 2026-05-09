import { useEffect, useCallback, useReducer } from "react";
import { trpc } from "../lib/trpc";
import { chebyshevDistance } from "../../../shared/movement";
import type { ActionSchema } from "../../../shared/game.schema";

// ─────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────

interface TargetTile { gridX: number; gridY: number; }

interface IdleState {
  mode:           "IDLE";
  itemId:         null;
  actionSchema:   null;
  selectedTiles:  TargetTile[];
  hoveredTile:    TargetTile | null;
}

interface TargetingState {
  mode:           "TARGETING";
  itemId:         string;
  actionSchema:   ActionSchema;
  selectedTiles:  TargetTile[];
  hoveredTile:    TargetTile | null;
}

type IntentState = IdleState | TargetingState;

const IDLE: IdleState = {
  mode:          "IDLE",
  itemId:        null,
  actionSchema:  null,
  selectedTiles: [],
  hoveredTile:   null,
};

type Action =
  | { type: "START";   itemId: string; actionSchema: ActionSchema }
  | { type: "ADD_TILE"; tile: TargetTile }
  | { type: "HOVER";    tile: TargetTile }
  | { type: "CANCEL" };

function reducer(state: IntentState, action: Action): IntentState {
  switch (action.type) {
    case "START":
      return {
        mode:          "TARGETING",
        itemId:        action.itemId,
        actionSchema:  action.actionSchema,
        selectedTiles: [],
        hoveredTile:   null,
      };
    case "ADD_TILE":
      if (state.mode !== "TARGETING") return state;
      return { ...state, selectedTiles: [...state.selectedTiles, action.tile] };
    case "HOVER":
      if (state.mode !== "TARGETING") return state;
      // Avoid state update if the tile hasn't changed (reduces Viewport redraws)
      if (
        state.hoveredTile?.gridX === action.tile.gridX &&
        state.hoveredTile?.gridY === action.tile.gridY
      ) return state;
      return { ...state, hoveredTile: action.tile };
    case "CANCEL":
      return IDLE;
    default:
      return state;
  }
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

interface Options {
  frogId:    number | null;
  frogPos:   { gridX: number; gridY: number } | null;
  /** Called after a successful submission so the parent can set lockedIn = true */
  onSuccess: () => void;
}

export function useItemIntentBuilder({ frogId, frogPos, onSuccess }: Options) {
  const [state, dispatch] = useReducer(reducer, IDLE);

  const submitItemAction = trpc.admin.submitItemActionForFrog.useMutation({
    onSuccess: () => {
      dispatch({ type: "CANCEL" });
      onSuccess();
    },
    onError: () => {
      // Reset to IDLE on failure — player can re-initiate without consuming a turn
      dispatch({ type: "CANCEL" });
    },
  });

  // Escape key cancels targeting
  useEffect(() => {
    if (state.mode !== "TARGETING") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "CANCEL" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.mode]);

  const startTargeting = useCallback((itemId: string, actionSchema: ActionSchema) => {
    dispatch({ type: "START", itemId, actionSchema });
  }, []);

  const handleTileClick = useCallback(
    (gridX: number, gridY: number) => {
      if (state.mode !== "TARGETING") return;
      if (!frogPos) return;

      const schema = state.actionSchema;
      const dist   = chebyshevDistance(frogPos.gridX, frogPos.gridY, gridX, gridY);

      // Client-side range guard — server re-validates at resolution time
      if (dist > schema.targeting.max_range) return;

      const newTile  = { gridX, gridY };
      const newTiles = [...state.selectedTiles, newTile];

      dispatch({ type: "ADD_TILE", tile: newTile });

      // Auto-submit once the required number of tiles are selected
      if (newTiles.length === schema.targeting.count && frogId != null) {
        submitItemAction.mutate({
          frogId,
          itemId:      state.itemId,
          action:      schema.action_name,
          targetTiles: newTiles.map((t) => ({ x: t.gridX, y: t.gridY })),
        });
      }
    },
    [state, frogPos, frogId, submitItemAction],
  );

  const handleTileHover = useCallback(
    (gridX: number, gridY: number) => {
      if (state.mode !== "TARGETING") return;
      dispatch({ type: "HOVER", tile: { gridX, gridY } });
    },
    [state.mode],
  );

  const cancel = useCallback(() => {
    dispatch({ type: "CANCEL" });
  }, []);

  return {
    mode:          state.mode,
    selectedTiles: state.selectedTiles,
    hoveredTile:   state.hoveredTile,
    startTargeting,
    handleTileClick,
    handleTileHover,
    cancel,
    error:         submitItemAction.error?.message ?? null,
    isPending:     submitItemAction.isPending,
  };
}
