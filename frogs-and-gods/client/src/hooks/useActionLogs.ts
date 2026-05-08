import { useEffect, useRef, useState } from "react";
import type { ActionLogEntry } from "../../../shared/game.schema";

const MAX_LOGS = 50;
const VISION_RADIUS = 24;

export function useActionLogs(frogX: number | null, frogY: number | null) {
  const [actionLogs, setActionLogs] = useState<ActionLogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const posRef = useRef({ frogX, frogY });

  // Keep posRef current without recreating the WebSocket on every position change
  useEffect(() => {
    posRef.current = { frogX, frogY };
  }, [frogX, frogY]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "IDENTIFY", role: "spectator" }));

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
