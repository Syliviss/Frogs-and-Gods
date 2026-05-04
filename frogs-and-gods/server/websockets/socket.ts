import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getWorldLogEmitter } from "./worldLogEmitter";
import type { WorldLogPayload } from "../../shared/game.schema";
import { heartbeat } from "../engine/heartbeat";
import { processMovementActions } from "../engine/tickProcessor";
import { validateAndQueueMovement } from "../engine/movement";
import { purgeResolvedActions } from "../db";

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

function emitToUser(userId: number, data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of Array.from(clients)) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
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
    broadcast({ type: "WORLD_LOG", payload });
  });

  // ── 500ms engine loop: process pending DB actions ──
  heartbeat.on("subtick", () => {
    void processMovementActions(emitToUser);
    broadcast({ type: "ENGINE_QUIVER", timestamp: Date.now() });
  });

  // ── 10s broadcast: push ENGINE_TICK so clients refetch their vision ──
  heartbeat.on("broadcast", () => {
    broadcast({ type: "ENGINE_TICK", timestamp: Date.now() });
    void purgeResolvedActions();
  });

  wss.on("connection", (ws: WebSocket, _req: unknown) => {
    const client: GameClient = { ws, role: "spectator" };
    clients.add(client);

    console.log(`[WS] Client connected. Total: ${clients.size}`);

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

          // ── Frog movement — writes directly to DB queue ──
          case "SUBMIT_ACTION": {
            if (client.role !== "frog" || !client.userId) {
              ws.send(JSON.stringify({ type: "ERROR", message: "Must be a frog player to submit actions." }));
              break;
            }
            void validateAndQueueMovement(
              client.userId,
              msg.actionType,
              msg.targetGridX,
              msg.targetGridY,
            ).then((result) => {
              ws.send(JSON.stringify(
                result.ok
                  ? { type: "ACTION_QUEUED", pendingActionId: result.pendingActionId }
                  : { type: "ERROR", message: result.message }
              ));
            });
            break;
          }

          // ── God interventions via WebSocket ──
          case "HEAL_FROG": {
            if (client.role !== "god") {
              ws.send(JSON.stringify({ type: "ERROR", message: "Only Gods can intervene." }));
              break;
            }
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
