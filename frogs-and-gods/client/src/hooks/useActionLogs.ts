import { useEffect, useRef, useState } from "react";
import type { ActionLogEntry } from "../../../shared/game.schema";

const MAX_LOGS = 50;
const VISION_RADIUS = 24;
const CHUNK_SIZE = 16;

export function useActionLogs(frogX: number | null, frogY: number | null) {
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const posRef = useRef({ frogX, frogY });
  const lastSentChunkRef = useRef<{ chunkX: number; chunkY: number } | null>(null);

  // Keep posRef current without recreating the WebSocket on every position change
  useEffect(() => {
    posRef.current = { frogX, frogY };
  }, [frogX, frogY]);

  // Send VIEWPORT_UPDATE when the frog crosses a chunk boundary
  useEffect(() => {
    if (frogX == null || frogY == null) return;
    const chunkX = Math.floor(frogX / CHUNK_SIZE);
    const chunkY = Math.floor(frogY / CHUNK_SIZE);
    const last = lastSentChunkRef.current;
    if (last?.chunkX === chunkX && last?.chunkY === chunkY) return;
    lastSentChunkRef.current = { chunkX, chunkY };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "VIEWPORT_UPDATE", chunkX, chunkY }));
    }
  }, [frogX != null ? Math.floor(frogX / CHUNK_SIZE) : null, frogY != null ? Math.floor(frogY / CHUNK_SIZE) : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "IDENTIFY", role: "spectator" }));
      const { frogX: fx, frogY: fy } = posRef.current;
      if (fx != null && fy != null) {
        const chunkX = Math.floor(fx / CHUNK_SIZE);
        const chunkY = Math.floor(fy / CHUNK_SIZE);
        lastSentChunkRef.current = { chunkX, chunkY };
        ws.send(JSON.stringify({ type: "VIEWPORT_UPDATE", chunkX, chunkY }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; logs?: ActionLogEntry[] };
        if (msg.type !== "SUBTICK_LOGS" || !msg.logs?.length) return;

        const { frogX: fx, frogY: fy } = posRef.current;
        if (fx === null || fy === null) return;

        const visible = msg.logs.filter(entry => {
          const dc = Math.max(Math.abs(entry.x - fx), Math.abs(entry.y - fy));
          return dc <= VISION_RADIUS;
        });

        if (visible.length === 0) return;
        setActionLogs(prev => [...visible, ...prev].slice(0, MAX_LOGS));
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => ws.close();

    return () => ws.close();
  }, []); // single socket for the lifetime of the hook

  return { actionLogs };
}
