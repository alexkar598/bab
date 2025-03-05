-- AlterTable
ALTER TABLE "Authorization" ALTER COLUMN "userIp" SET DATA TYPE TEXT;
UPDATE "Authorization" SET "userIp" = LEFT("userIp", -3) WHERE "Authorization"."userIp" LIKE '%/32';