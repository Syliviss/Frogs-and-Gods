import { useEffect, useRef, useState, useCallback } from "react";
import type { WorldLogPayload } from "../../../shared/game.schema";

export interface WorldLogMessage {
  type: string;
  payload?: WorldLogPayload;
  message?: string;
  timestamp?: number;
}

interface UseWorldLogOptions {
  role?: "frog" | "god" | "spectator";
  userId?: number;
  godId?: number;
  maxEntries?: number;
}

export function useWorldLog(options: UseWorldLogOptions = {}) {
  const { role = "spectator", userId, godId, maxEntries = 100 } = options;
  const [entries, setEntries] = useState<WorldLogPayload[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Identify this client
      ws.send(JSON.stringify({ type: "IDENTIFY", role, userId, godId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: WorldLogMessage = JSON.parse(event.data);
        if (msg.type === "WORLD_LOG" && msg.payload) {
          setEntries((prev) => {
            const next = [msg.payload!, ...prev];
            return next.slice(0, maxEntries);
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [role, userId, godId, maxEntries]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendIntervention = useCallback(
    (type: "HEAL_FROG" | "SMITE_ENEMY", payload: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, ...payload }));
      }
    },
    []
  );

  return { entries, connected, sendIntervention };
}
