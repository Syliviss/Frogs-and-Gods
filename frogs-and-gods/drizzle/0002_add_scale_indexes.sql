-- Scale indexes: cover the five hot query paths identified in the scalability audit.
-- frogs: owner lookup (submission gate) + spatial bounding box (Great Inhale)
CREATE INDEX IF NOT EXISTS "idx_frogs_owner" ON "frogs"("ownerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_frogs_grid" ON "frogs"("grid_x","grid_y");--> statement-breakpoint
-- items: owner+state lookup (EQUIP/PICKUP handlers) + spatial bounding box (Great Inhale)
CREATE INDEX IF NOT EXISTS "idx_items_owner_state" ON "items"("owner_id","item_state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_items_grid" ON "items"("grid_x","grid_y");--> statement-breakpoint
-- pending_actions: actor dedup gate called on every SUBMIT_ACTION
CREATE INDEX IF NOT EXISTS "idx_pending_actor_status" ON "pending_actions"("actor_id","status");--> statement-breakpoint
-- world_log_events: createdAt scan for getRecentWorldLog (grows unbounded)
CREATE INDEX IF NOT EXISTS "idx_worldlog_created_at" ON "world_log_events"("createdAt");
