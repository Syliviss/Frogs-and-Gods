import type { ActionLogEntry } from "../../../shared/game.schema";

interface Props {
  logs: ActionLogEntry[];
}

export function ActionLog({ logs }: Props) {
  if (logs.length === 0) return null;

  return (
    <div className="action-log-container">
      <div className="action-log-header">Action Log</div>
      <div className="action-log-scroll">
        {logs.map((entry, i) => (
          <div
            key={`${entry.chunk_id}-${entry.x}-${entry.y}-${i}`}
            className={`action-log-entry log-${entry.category}`}
            style={{ opacity: Math.max(0.25, 1 - i * 0.018) }}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  );
}
