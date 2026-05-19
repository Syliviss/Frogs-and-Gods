import type { TileChar } from "./game.schema";

export interface TileDef {
  char:       TileChar;
  label:      string;
  color:      string;     // hex — used by Viewport ASCII renderer
  isWater:    boolean;    // true = open water; triggers swim mode when frog stands here
  isLilyPad:  boolean;    // true = swim-passable but frog can also hop/step from here
  imagePath?: string;     // future: swap glyph for a local image (e.g. "/assets/tiles/lilypad.png")
}

export const TILE_REGISTRY: Record<TileChar, TileDef> = {
  "≈": { char: "≈", label: "Deep Lake", color: "#1a5f8a", isWater: true,  isLilyPad: false },
  "+": { char: "+", label: "Shore",     color: "#2a7a5a", isWater: true,  isLilyPad: false },
  "~": { char: "~", label: "River",     color: "#1e8870", isWater: true,  isLilyPad: false },
  "@": { char: "@", label: "Lily Pad",  color: "#4a7a20", isWater: false, isLilyPad: true  },
  "#": { char: "#", label: "Land",      color: "#5f9a30", isWater: false, isLilyPad: false },
  "%": { char: "%", label: "Lily Pad",  color: "#4a7a20", isWater: false, isLilyPad: true  },
  "D": { char: "D", label: "Lair Door", color: "#9333ea", isWater: false, isLilyPad: false },
  "^": { char: "^", label: "Peak",      color: "#a0a0b0", isWater: false, isLilyPad: false },
};

export function getTileDef(char: string): TileDef | undefined {
  return TILE_REGISTRY[char as TileChar];
}
