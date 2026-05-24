import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { getWorldLogEmitter } from "./worldLogEmitter";
import type { WorldLogPayload } from "../../shared/game.schema";
import { heartbeat } from "../engine/heartbeat";
import { processAllActions } from "../engine/tickProcessor";
import { processEntityIntents } from "../entities/index";
import { runPoiHeartbeatPass } from "../poi/processor";
import { validateAndQueueMovement } from "../engine/movement";
import { getFrogByOwnerId, getFrogById, createPendingAction, purgeResolvedActions, purgeDeadFrogs, purgeOldWorldLogEvents, getDb } from "../db";
import { flushActionLogs } from "../engine/actionLog";
import { pendingActions, type InsertPendingAction } from "../../drizzle/schema";

// ─────────────────────────────────────────────
// CONNECTED CLIENTS REGISTRY
// ─────────────────────────────────────────────

interface GameClient {
  ws: WebSocket;
  role: "frog" | "god" | "spectator";
  userId?: number;
  godId?: number;
  viewportChunkX?: number;
  viewportChunkY?: number;
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

// Sends only to clients whose 3×3 viewport (±1 chunk) overlaps the event chunk.
// Spectators with no viewport get all events (admin observers).
// Frogs and gods with no viewport get nothing — they must send VIEWPORT_UPDATE first.
function broadcastToChunkArea(eventChunkX: number, eventChunkY: number, data: unknown): void {
  const message = JSON.stringify(data);
  for (const client of Array.from(clients)) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.viewportChunkX == null || client.viewportChunkY == null) {
      if (client.role === "spectator") client.ws.send(message);
      continue;
    }
    const dx = Math.abs(client.viewportChunkX - eventChunkX);
    const dy = Math.abs(client.viewportChunkY - eventChunkY);
    if (dx <= 1 && dy <= 1) client.ws.send(message);
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
// INTAKE BUFFER (100ms batch insert)
// ─────────────────────────────────────────────

let pendingIntents: InsertPendingAction[] = [];

setInterval(() => {
  if (pendingIntents.length === 0) return;
  const batch = [...pendingIntents];
  pendingIntents = [];

  getDb().then(async (db) => {
    if (!db) return;
    try {
      await db.insert(pendingActions).values(batch);
    } catch (err) {
      console.error("[WS] Intake Buffer Error:", err);
    }
  }).catch((err) => console.error("[WS] Failed to get DB for buffer:", err));
}, 100);

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
    if (payload.chunkX != null && payload.chunkY != null) {
      broadcastToChunkArea(payload.chunkX, payload.chunkY, { type: "WORLD_LOG", payload });
    } else {
      broadcast({ type: "WORLD_LOG", payload });
    }
  });

  // ── Tick sequencing: skip the next subtick if the previous exhale hasn't committed yet.
  //    If the 10s broadcast arrives while a tick is still running, hold it until the tick finishes.
  let tickInFlight = false;
  let broadcastPending = false;
  let _worldLogPurgeCycle = 0;

  async function runEngineBroadcast(): Promise<void> {
    // POI heartbeat pass — runs and commits BEFORE ENGINE_TICK so players see POI
    // activations (spawned predators) in the same vision refresh as everything else.
    try {
      await runPoiHeartbeatPass();
    } catch (err) {
      console.error("[POI] Heartbeat pass failed:", err);
    }

    broadcast({ type: "ENGINE_TICK", timestamp: Date.now() });
    void purgeResolvedActions();
    void purgeDeadFrogs();
    _worldLogPurgeCycle++;
    if (_worldLogPurgeCycle >= 1000) {
      _worldLogPurgeCycle = 0;
      void purgeOldWorldLogEvents();
    }

    // Entity AI for the new cycle — runs after the POI pass so predators spawned
    // this heartbeat are committed and picked up by getActivePredators().
    void processEntityIntents(emitToUser);
  }

  // ── 500ms engine loop: process pending DB actions ──
  heartbeat.on("subtick", () => {
    if (tickInFlight) return;
    tickInFlight = true;

    void processAllActions(emitToUser)
      .then(() => {
        const logs = flushActionLogs();
        if (logs.length > 0) {
          const fullMessage = JSON.stringify({ type: "SUBTICK_LOGS", logs });
          for (const client of Array.from(clients)) {
            if (client.ws.readyState !== WebSocket.OPEN) continue;
            if (client.viewportChunkX == null || client.viewportChunkY == null) {
              if (client.role === "spectator") client.ws.send(fullMessage);
              continue;
            }
            const relevant = logs.filter(log => {
              const [cx, cy] = log.chunk_id.split(":").map(Number);
              return Math.abs(cx - client.viewportChunkX!) <= 1
                  && Math.abs(cy - client.viewportChunkY!) <= 1;
            });
            if (relevant.length > 0)
              client.ws.send(relevant.length === logs.length
                ? fullMessage
                : JSON.stringify({ type: "SUBTICK_LOGS", logs: relevant }));
          }
        }
        broadcast({ type: "ENGINE_QUIVER", timestamp: Date.now() });
      })
      .finally(() => {
        tickInFlight = false;
        if (broadcastPending) {
          broadcastPending = false;
          void runEngineBroadcast();
        }
      });
  });

  // ── 10s broadcast: run the POI pass, push ENGINE_TICK, queue entity AI ──
  heartbeat.on("broadcast", () => {
    if (tickInFlight) {
      broadcastPending = true;
      return;
    }
    void runEngineBroadcast();
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

          // ── Viewport position report — enables spatial broadcast culling ──
          case "VIEWPORT_UPDATE": {
            client.viewportChunkX = msg.chunkX;
            client.viewportChunkY = msg.chunkY;
            break;
          }

          // ── All frog actions — routes movement through legacy validator,
          //    item actions directly to the pending_actions queue ──
          case "SUBMIT_ACTION": {
            if (client.role !== "frog" || !client.userId) {
              ws.send(JSON.stringify({ type: "ERROR", message: "Must be a frog player to submit actions." }));
              break;
            }

            const MOVE_TYPES = new Set(["STEP", "HOP", "DASH"]);

            if (MOVE_TYPES.has(msg.actionType)) {
              // Movement: use existing validator (tile lookup + cost check at queue time)
              // TODO: This should be refactored into the Inhale/Exhale system later,
              // but for now we maintain its structure or buffer it?
              // Actually, validateAndQueueMovement queries the DB directly. We will refactor it
              // in Phase 2/3. For now, we leave it or buffer it. Let's buffer it!
              // For Phase 1 we will just buffer the raw intent.
              
              // We'll queue it for the heartbeat to resolve.
              void getFrogByOwnerId(client.userId).then((frog) => {
                if (!frog) return ws.send(JSON.stringify({ type: "ERROR", message: "No active Frog found." }));
                if (frog.isDead) return ws.send(JSON.stringify({ type: "ERROR", message: "Dead Frogs cannot act." }));

                const resolveBucket = Math.floor(Date.now() / 500);
                pendingIntents.push({
                  actorId:       frog.id,
                  actionType:    msg.actionType,
                  targetGridX:   msg.targetGridX ?? null,
                  targetGridY:   msg.targetGridY ?? null,
                  resolveBucket,
                  payload:       msg.payload ?? {},
                });
                // We don't have pendingActionId immediately anymore
                ws.send(JSON.stringify({ type: "ACTION_QUEUED", message: "Action buffered." }));
              }).catch(() => {
                ws.send(JSON.stringify({ type: "ERROR", message: "Failed to buffer action." }));
              });

            } else {
              // Item / other actions
              void getFrogByOwnerId(client.userId).then((frog) => {
                if (!frog) return ws.send(JSON.stringify({ type: "ERROR", message: "No active Frog found." }));
                if (frog.isDead) return ws.send(JSON.stringify({ type: "ERROR", message: "Dead Frogs cannot act." }));

                const resolveBucket = Math.floor(Date.now() / 500);
                pendingIntents.push({
                  actorId:       frog.id,
                  actionType:    msg.actionType,
                  targetGridX:   msg.targetGridX ?? null,
                  targetGridY:   msg.targetGridY ?? null,
                  resolveBucket,
                  payload:       msg.payload ?? {},
                });
                
                ws.send(JSON.stringify({ type: "ACTION_QUEUED", message: "Action buffered." }));
              }).catch(() => {
                ws.send(JSON.stringify({ type: "ERROR", message: "Failed to buffer action." }));
              });
            }
            break;
          }

          // ── God interventions via WebSocket ──
          case "HEAL_FROG": {
            if (client.role !== "god") {
              ws.send(JSON.stringify({ type: "ERROR", message: "Only Gods can intervene." }));
              break;
            }
            void (async () => {
              const targetFrog = msg.targetFrogId ? await getFrogById(msg.targetFrogId) : undefined;
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
                chunkX: targetFrog ? Math.floor(targetFrog.gridX / 16) : undefined,
                chunkY: targetFrog ? Math.floor(targetFrog.gridY / 16) : undefined,
              };
              emitter.emitWorldEvent(healPayload);
            })();
            break;
          }

          case "SMITE_ENEMY": {
            if (client.role !== "god") {
              ws.send(JSON.stringify({ type: "ERROR", message: "Only Gods can intervene." }));
              break;
            }
            // No spatial target available in smite payload — broadcasts globally.
            // Add chunkX/chunkY here once the smite target's position is passed by the client.
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
