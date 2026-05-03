import { useEffect, useRef, useState, useCallback } from "react";

export type EngineLogEntry =
  | { kind: "tick";   timestamp: number; totalActions: number; bucketCounts: Record<number, number> }
  | { kind: "quiver"; timestamp: number; bucketId: number };

export function useEngineLog(maxEntries = 300) {
  const [entries, setEntries]   = useState<EngineLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef           = useRef<WebSocket | null>(null);
  const reconnectTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "IDENTIFY", role: "spectator" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "ENGINE_TICK") {
          setEntries((prev) =>
            [
              { kind: "tick" as const, timestamp: msg.timestamp as number, totalActions: msg.totalActions as number, bucketCounts: (msg.bucketCounts ?? {}) as Record<number, number> },
              ...prev,
            ].slice(0, maxEntries)
          );
        } else if (msg.type === "ENGINE_QUIVER") {
          setEntries((prev) =>
            [
              { kind: "quiver" as const, timestamp: msg.timestamp as number, bucketId: msg.bucketId as number },
              ...prev,
            ].slice(0, maxEntries)
          );
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [maxEntries]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { entries, connected };
}
