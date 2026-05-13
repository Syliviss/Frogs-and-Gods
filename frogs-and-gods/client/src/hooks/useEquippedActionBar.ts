import { useCallback } from "react";
import { trpc } from "../lib/trpc";
import { useItemIntentBuilder } from "./useItemIntentBuilder";
import type { ActionSchema } from "../../../shared/game.schema";
import type { EquippedActionEntry } from "../components/ActionBar";

interface Options {
  frogId:  number | null;
  frogPos: { gridX: number; gridY: number } | null;
  onSuccess: () => void;
}

export function useEquippedActionBar({ frogId, frogPos, onSuccess }: Options) {
  const equippedActionsQuery = trpc.frog.getEquippedActions.useQuery(
    { frogId: frogId! },
    { enabled: frogId != null },
  );

  const intentBuilder = useItemIntentBuilder({ frogId, frogPos, onSuccess });

  const onAction = useCallback(
    (_actionName: string, itemId: string, actionSchema?: ActionSchema | null) => {
      if (actionSchema) intentBuilder.startTargeting(itemId, actionSchema);
    },
    [intentBuilder],
  );

  const refetch = useCallback(() => {
    void equippedActionsQuery.refetch();
  }, [equippedActionsQuery]);

  return {
    // ── ActionBar props ──────────────────────
    equippedActions: (equippedActionsQuery.data ?? []) as EquippedActionEntry[],
    targetingMode:   intentBuilder.mode === "TARGETING",
    onAction,
    onCancelTarget:  intentBuilder.cancel,
    error:           intentBuilder.error,

    // ── Viewport props (active only in targeting mode) ──
    targetingTiles:  intentBuilder.selectedTiles,
    hoveredTile:     intentBuilder.hoveredTile,
    handleTileClick: intentBuilder.handleTileClick,
    handleTileHover: intentBuilder.handleTileHover,
    cancelTargeting: intentBuilder.cancel,

    // ── Tick hook ───────────────────────────
    refetch,
  };
}
