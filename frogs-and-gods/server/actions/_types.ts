import type { Frog, Item } from "../../drizzle/schema";

export interface ActionContext {
  frogId:       number;
  userId:       number;
  actionType:   string;
  payload:      Record<string, unknown>;
  targetGridX?: number;
  targetGridY?: number;
  /** Resolved frog row — populated by runAction before calling the handler */
  frog?:        Frog;
}

/**
 * Result returned by validate().
 *
 * **Silent reject** (`ok: false`, no `code`):
 * The action is refused but the frog's turn is *preserved*. Use for structural
 * errors — bad payload, item not found, wrong state — where the frog shouldn't
 * be penalised for the mismatch. The heartbeat gate remains open.
 *
 * **Fumble** (`ok: false, code: "FUMBLE"`):
 * The frog genuinely *attempted* the action but failed at runtime (e.g. stomach
 * full, equip slots maxed, cursed item blocking). The turn is *consumed*:
 * `runAction` inserts a sentinel `FUMBLE` row into `pending_actions` with
 * `status = "resolved"`, which trips `hasFrogActedThisHeartbeat()` and blocks
 * any further actions for the rest of the 10-second heartbeat window. A FUMBLE
 * notification is broadcast to the player. Reserve this code for "tried and
 * failed" outcomes, not for invalid requests.
 */
export interface ValidationResult {
  ok:       boolean;
  code?:    string;
  message?: string;
}

export interface ExecuteResult {
  success: boolean;
  data?:   unknown;
}

export type NotifyFn = (userId: number, data: unknown) => void;

export interface ActionHandler {
  // @param ctx - full action context including resolved frog
  // @returns ValidationResult — FUMBLE code consumes the turn
  validate:  (ctx: ActionContext) => Promise<ValidationResult>;

  // @param ctx - same context; only called when validate() returns ok: true
  // @returns ExecuteResult with any data relevant to broadcast
  execute:   (ctx: ActionContext) => Promise<ExecuteResult>;

  // @param ctx - same context
  // @param result - output from execute()
  // @param notify - sends a WS message to a specific userId
  broadcast: (ctx: ActionContext, result: ExecuteResult, notify: NotifyFn) => Promise<void>;
}

// ─────────────────────────────────────────────
// Shared item-based fumble check helper
// Call inside every action's validate() to honour the blockedActions contract.
// ─────────────────────────────────────────────

/**
 * Scans the frog's EQUIPPED + INVENTORY items for any that block the given action.
 * Returns a FUMBLE ValidationResult if blocked, null otherwise.
 */
export async function checkItemFumble(
  frogId: number,
  actionType: string,
  inventoryItems: Item[],
): Promise<ValidationResult | null> {
  for (const item of inventoryItems) {
    const blocked = item.statsJson?.blockedActions ?? [];
    if (blocked.includes(actionType)) {
      return {
        ok:      false,
        code:    "FUMBLE",
        message: `Action blocked by ${item.name}!`,
      };
    }
  }
  return null;
}
