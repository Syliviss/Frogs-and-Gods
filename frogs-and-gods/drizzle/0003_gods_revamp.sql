ALTER TABLE "gods" RENAME COLUMN "divine_power" TO "favor";
ALTER TABLE "gods" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "gods" ADD COLUMN "starting_powers" jsonb DEFAULT '[]'::jsonb NOT NULL;
