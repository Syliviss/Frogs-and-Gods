import type { NotifyFn } from "./_types";

export interface GodActionContext {
  actionType: string;
  payload:    Record<string, unknown>;
}

export interface GodActionResult {
  success: boolean;
  data?:   unknown;
  error?:  string;
}

export interface GodActionHandler {
  validate:  (ctx: GodActionContext) => Promise<GodActionResult>;
  execute:   (ctx: GodActionContext) => Promise<GodActionResult>;
  broadcast: (ctx: GodActionContext, result: GodActionResult, notify: NotifyFn) => Promise<void>;
}
