import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

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
  validate:  (ctx: GodActionContext, state: SimulatedState) => Promise<GodActionResult> | GodActionResult;
  execute:   (ctx: GodActionContext, state: SimulatedState, out: UpdateInstruction[]) => Promise<GodActionResult> | GodActionResult;
  broadcast: (ctx: GodActionContext, result: GodActionResult, notify: NotifyFn) => Promise<void> | void;
}
