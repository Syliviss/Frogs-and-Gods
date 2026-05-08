export const GOD_ACTION_TYPES = ["CREATE_ITEM", "SPAWN_ITEM"] as const;
export type GodActionType = (typeof GOD_ACTION_TYPES)[number];
