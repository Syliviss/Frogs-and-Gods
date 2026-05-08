import { eq } from "drizzle-orm";
import { getDb, getChunksByCoords, getEquippedItemsByFrogId } from "../db";
import { frogs, pendingActions } from "../../drizzle/schema";
import {
  calculateRemainingMove,
  chebyshevDistance,
  MOVE_MAX_RANGE,
  type MoveType,
} from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { TileChar } from "../../shared/game.schema";
import { pushActionLog } from "../engine/actionLog";
import { checkItemFumble } from "./_types";
import type { ActionContext, ValidationResult, ExecuteResult, NotifyFn, ActionHandler } from "./_types";

export function makeMoveHandler(actionType: MoveType): ActionHandler {
  return {
    async validate(ctx: ActionContext): Promise<ValidationResult> {
      const frog = ctx.frog!;

      // Item-based fumble check
      const equipped = await getEquippedItemsByFrogId(frog.id);
      const fumble = await checkItemFumble(frog.id, actionType, equipped);
      if (fumble) return fumble;

      if (ctx.targetGridX == null || ctx.targetGridY == null) {
        return { ok: false, message: "Target coordinates required." };
      }

      // Chebyshev distance gate
      const dist     = chebyshevDistance(frog.gridX, frog.gridY, ctx.targetGridX, ctx.targetGridY);
      const maxRange = MOVE_MAX_RANGE[actionType];
      if (dist > maxRange) {
        return {
          ok:      false,
          message: `${actionType} max range is ${maxRange} tiles (attempted ${dist}).`,
        };
      }

      // Target tile lookup
      const chunkX  = Math.floor(ctx.targetGridX / CHUNK_SIZE);
      const chunkY  = Math.floor(ctx.targetGridY / CHUNK_SIZE);
      const chunks  = await getChunksByCoords([{ chunkX, chunkY }]);
      const terrain: string[][] = chunks[0]?.terrainDataJson
        ? JSON.parse(chunks[0].terrainDataJson)
        : [];
      const localX     = ((ctx.targetGridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localY     = ((ctx.targetGridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const targetChar = (terrain[localY]?.[localX] ?? "#") as TileChar;

      // Movement cost gate
      const moveResult = calculateRemainingMove(actionType, frog.statsJson, "#" as TileChar, targetChar);
      if (!moveResult.legal) {
        return {
          ok:      false,
          message: `Not enough movement points (cost ${moveResult.cost}, budget ${moveResult.cost + moveResult.remaining}).`,
        };
      }

      return { ok: true };
    },

    async execute(ctx: ActionContext): Promise<ExecuteResult> {
      const db = await getDb();
      if (!db) return { success: false };

      const frog = ctx.frog!;
      const tx   = ctx.targetGridX!;
      const ty   = ctx.targetGridY!;

      // Re-validate tile cost at resolution time (double-validation pattern)
      const chunkX  = Math.floor(tx / CHUNK_SIZE);
      const chunkY  = Math.floor(ty / CHUNK_SIZE);
      const chunks  = await getChunksByCoords([{ chunkX, chunkY }]);
      const terrain: string[][] = chunks[0]?.terrainDataJson
        ? JSON.parse(chunks[0].terrainDataJson)
        : [];
      const localX     = ((tx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localY     = ((ty % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const targetChar = (terrain[localY]?.[localX] ?? "#") as TileChar;
      const moveResult = calculateRemainingMove(actionType, frog.statsJson, "#" as TileChar, targetChar);

      await db.transaction(async (dbTx) => {
        if (moveResult.legal) {
          await dbTx.update(frogs).set({ gridX: tx, gridY: ty }).where(eq(frogs.id, frog.id));
        }
        // The pending_action row is marked resolved by the tickProcessor after runAction returns
      });

      return { success: moveResult.legal, data: { targetGridX: tx, targetGridY: ty, legal: moveResult.legal } };
    },

    async broadcast(ctx: ActionContext, result: ExecuteResult, notify: NotifyFn): Promise<void> {
      const frog = ctx.frog!;
      const tx   = ctx.targetGridX!;
      const ty   = ctx.targetGridY!;
      const data = result.data as { legal: boolean } | undefined;
      const legal = data?.legal ?? false;

      const verbs: Record<string, string> = { STEP: "steps", HOP: "hops", DASH: "dashes" };
      const verb = verbs[actionType] ?? "moves";

      pushActionLog({
        text:     legal
          ? `${frog.name} ${verb} to (${tx}, ${ty})`
          : `${frog.name}'s ${verb} to (${tx}, ${ty}) was blocked`,
        x:        tx,
        y:        ty,
        chunk_id: `${Math.floor(tx / CHUNK_SIZE)}:${Math.floor(ty / CHUNK_SIZE)}`,
        category: "movement",
      });

      if (frog.ownerId != null) {
        notify(frog.ownerId, {
          type:        "ACTION_RESOLVED",
          actionType,
          legal,
          targetGridX: tx,
          targetGridY: ty,
        });
      }
    },
  };
}
