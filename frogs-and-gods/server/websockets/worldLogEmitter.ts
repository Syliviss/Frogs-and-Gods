import { EventEmitter } from "events";
import type { WorldLogPayload } from "../../shared/game.schema";

// ─────────────────────────────────────────────
// WORLD LOG EVENT EMITTER (singleton)
// ─────────────────────────────────────────────
// This emitter bridges the REST combat API and the WebSocket hub.
// When a combat turn completes, the router emits a "worldEvent" here.
// The WebSocket handler subscribes and broadcasts to all connected Gods.

class WorldLogEmitter extends EventEmitter {
  emitWorldEvent(payload: WorldLogPayload): void {
    this.emit("worldEvent", payload);
  }
}

let _emitter: WorldLogEmitter | null = null;

export function getWorldLogEmitter(): WorldLogEmitter {
  if (!_emitter) {
    _emitter = new WorldLogEmitter();
    _emitter.setMaxListeners(200);
  }
  return _emitter;
}
