import type { ActionLogEntry } from "../../shared/game.schema";

export type { ActionLogEntry };

const ANSI = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
};

let buffer: ActionLogEntry[] = [];

export function pushActionLog(entry: ActionLogEntry): void {
  buffer.push(entry);
}

export function flushActionLogs(): ActionLogEntry[] {
  const snapshot = buffer;
  buffer = [];

  for (const entry of snapshot) {
    const color =
      entry.category === "combat" ? ANSI.red :
      entry.category === "god"    ? ANSI.cyan :
      entry.text.includes("blocked") ? ANSI.yellow :
      ANSI.green;
    console.log(`${color}[ACTION] ${entry.text}${ANSI.reset}`);
  }

  return snapshot;
}
