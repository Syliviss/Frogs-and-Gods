import type { TileChar } from "./game.schema";

export interface TileDef {
  char:         TileChar;
  label:        string;
  color:        string;   // hex — used by Viewport ASCII renderer
  movementCost: number;   // movement points consumed to enter this tile
  imagePath?:   string;   // future: swap glyph for a local image (e.g. "/assets/tiles/lilypad.png")
}

export const TILE_REGISTRY: Record<TileChar, TileDef> = {
  "≈": { char: "≈", label: "Deep Lake",  color: "#1a5f8a", movementCost: 5 },
  "+": { char: "+", label: "Shore",      color: "#2a7a5a", movementCost: 3 },
  "~": { char: "~", label: "River",      color: "#1e8870", movementCost: 4 },
  "@": { char: "@", label: "Lily Pad",   color: "#4a7a20", movementCost: 1 },
  "#": { char: "#", label: "Land",       color: "#5f9a30", movementCost: 2 },
  "%": { char: "%", label: "Lily Pad",   color: "#4a7a20", movementCost: 1 },
  "D": { char: "D", label: "Lair Door",  color: "#9333ea", movementCost: 1 },
};

export function getTileDef(char: string): TileDef | undefined {
  return TILE_REGISTRY[char as TileChar];
}
