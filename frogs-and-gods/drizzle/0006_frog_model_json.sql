-- Add model_json column to frogs table for per-frog pixel art sprite data
-- Nullable so existing rows are not broken; populated at frog creation via generateFrogPixelData
ALTER TABLE frogs DROP COLUMN IF EXISTS model_json;
ALTER TABLE frogs ADD COLUMN model_json jsonb;
