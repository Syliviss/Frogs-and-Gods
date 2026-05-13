export type PoiType = "SHRINE" | "DUNGEON" | "RESOURCE_NODE" | "SPAWN_ZONE" | "LANDMARK";

export interface PoiDef {
  id:      string;
  name:    string;
  type:    PoiType;
  anchorX: number;
  anchorY: number;
  tiles?:  Array<{ dx: number; dy: number; char: string }>;
}
