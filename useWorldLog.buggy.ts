/**
 * ============================================================
 * BUGGY VERSION — kept for reference only.
 * ============================================================
 *
 * Problems:
 *   1. Blindly casts the parsed WebSocket message to
 *      WorldLogPayloadBuggy with no runtime check.
 *   2. If the server sends a malformed "God intervention" event
 *      (missing fields, wrong types) the frontend crashes with
 *      an unhandled TypeError deep inside the render tree.
 *   3. No type guard — the TypeScript type offers zero
 *      protection at runtime.
 */

import { WorldLogPayloadBuggy } from "./game.schema.buggy";

type Listener = (entry: WorldLogPayloadBuggy) => void;

export function useWorldLogBuggy(onEntry: Listener): void {
  // Simulated WebSocket message handler
  const handleMessage = (raw: MessageEvent) => {
    // BUG: no validation — trusting the wire blindly
    const data = JSON.parse(raw.data as string) as WorldLogPayloadBuggy;
    onEntry(data);
  };

  // In a real hook this would call ws.addEventListener / ws.removeEventListener
  void handleMessage;
}
