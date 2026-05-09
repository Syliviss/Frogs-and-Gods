export const PREDATOR_ACTION_TYPES = ["SLITHER", "STRIKE", "WRAP"] as const;
export type PredatorActionType = (typeof PREDATOR_ACTION_TYPES)[number];
