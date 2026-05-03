import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getWorldLogEmitter } from "./worldLogEmitter";
import type { WorldLogPayload } from "../../shared/game.schema";
import { heartbeat } from "../engine/heartbeat";

// ─────────────────────────────────────────────
// CONNECTED CLIENTS REGISTRY
// ─────────────────────────────────────────────

interface GameClient {
  ws: WebSocket;
  role: "frog" | "god" | "spectator";
  userId?: number;
  godId?: number;
}

const clients = new Set<GameClient>();

function broadcast(data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of Array.from(clients)) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

function broadcastToGods(data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of Array.from(clients)) {
    if (client.ws.readyState === WebSocket.OPEN && client.role === "god") {
      client.ws.send(message);
    }
  }
}

// ─────────────────────────────────────────────
// ATTACH WEBSOCKET SERVER
// ─────────────────────────────────────────────

export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = req.url?.split("?")[0];
    if (pathname !== "/ws") return;
    wss.handleUpgrade(req, socket as import("net").Socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // ── Subscribe to World Log emitter ──
  const emitter = getWorldLogEmitter();
  emitter.on("worldEvent", (payload: WorldLogPayload) => {
    // Broadcast every combat event to ALL connected clients (Gods watch, Frogs see their own log)
    broadcast({ type: "WORLD_LOG", payload });
  });

  // ── Subscribe to engine heartbeat events ──
  heartbeat.on("resolution", (drained: Map<number, unknown[]>) => {
    const bucketCounts: Record<number, number> = {};
    let totalActions = 0;
    for (const [bucketId, actions] of drained) {
      bucketCounts[bucketId] = actions.length;
      totalActions += actions.length;
    }
    broadcast({ type: "ENGINE_TICK", timestamp: Date.now(), totalActions, bucketCounts });
  });

  heartbeat.on("subtick", (bucketId: number) => {
    broadcast({ type: "ENGINE_QUIVER", timestamp: Date.now(), bucketId });
  });

  wss.on("connection", (ws: WebSocket, _req: unknown) => {
    const client: GameClient = { ws, role: "spectator" };
    clients.add(client);

    console.log(`[WS] Client connected. Total: ${clients.size}`);

    // ── Send recent world log on connect ──
    ws.send(JSON.stringify({ type: "CONNECTED", message: "Welcome to the World Log." }));

    ws.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          // ── Identity registration ──
          case "IDENTIFY": {
            client.role = msg.role ?? "spectator";
            client.userId = msg.userId;
            client.godId = msg.godId;
            ws.send(JSON.stringify({ type: "IDENTIFIED", role: client.role }));
            break;
          }

          // ── God interventions via WebSocket ──
          // Note: Interventions can also be submitted via tRPC (preferred).
          // This WebSocket path is for ultra-low-latency God actions.
          case "HEAL_FROG": {
            if (client.role !== "god") {
              ws.send(JSON.stringify({ type: "ERROR", message: "Only Gods can intervene." }));
              break;
            }
            // Emit back to all clients so the World Log updates immediately
            const healPayload: WorldLogPayload = {
              encounterId: msg.encounterId,
              frogId: msg.targetFrogId,
              frogName: msg.frogName ?? "Unknown Frog",
              godId: client.godId,
              godName: msg.godName ?? "A God",
              eventType: "HEAL_FROG",
              message: `${msg.godName ?? "A God"} heals ${msg.frogName ?? "a Frog"}!`,
              heal: msg.healAmount ?? 25,
              timestamp: Date.now(),
            };
            emitter.emitWorldEvent(healPayload);
            break;
          }

          case "SMITE_ENEMY": {
            if (client.role !== "god") {
              ws.send(JSON.stringify({ type: "ERROR", message: "Only Gods can intervene." }));
              break;
            }
            const smitePayload: WorldLogPayload = {
              encounterId: msg.encounterId,
              godId: client.godId,
              godName: msg.godName ?? "A God",
              eventType: "SMITE_ENEMY",
              message: `${msg.godName ?? "A God"} smites the enemy with divine fury!`,
              damage: msg.smiteDamage ?? 50,
              timestamp: Date.now(),
            };
            emitter.emitWorldEvent(smitePayload);
            break;
          }

          case "PING": {
            ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
            break;
          }

          default:
            ws.send(JSON.stringify({ type: "ERROR", message: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: "ERROR", message: "Invalid JSON message." }));
      }
    });

    ws.on("close", () => {
      clients.delete(client);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on("error", (err: Error) => {
      console.error("[WS] Error:", err.message);
      clients.delete(client);
    });
  });

  console.log("[WS] WebSocket server attached at /ws");
  return wss;
}

export { broadcast, broadcastToGods };
