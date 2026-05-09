import type { Predator } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";

export interface PredatorActionContext {
  actionType:  string;
  actorId:     number;
  targetGridX: number;
  targetGridY: number;
  payload:     Record<string, unknown>;
}

export interface PredatorActionResult {
  success: boolean;
  data?:   unknown;
  error?:  string;
}

export interface PredatorActionHandler {
  validate:  (ctx: PredatorActionContext, predator: Predator) => Promise<PredatorActionResult>;
  execute:   (ctx: PredatorActionContext, predator: Predator) => Promise<PredatorActionResult>;
  broadcast: (ctx: PredatorActionContext, predator: Predator, result: PredatorActionResult, notify: NotifyFn) => Promise<void>;
}
