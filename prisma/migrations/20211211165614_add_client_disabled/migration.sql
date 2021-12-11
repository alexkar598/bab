-- AlterTable
ALTER TABLE "Authorization" ALTER COLUMN "startDate" SET DEFAULT (now() at time zone 'utc'),
ALTER COLUMN "byondState" SET DEFAULT substring(gen_random_bytes(24)::text FROM 3);

-- AlterTable
ALTER TABLE "ByondCert" ALTER COLUMN "encodedCert" SET DEFAULT substring(gen_random_bytes(24)::text FROM 3),
ALTER COLUMN "createdTime" SET DEFAULT (now() at time zone 'utc');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "disabled" TEXT;

-- AlterTable
ALTER TABLE "SigningKey" ALTER COLUMN "createdTime" SET DEFAULT (now() at time zone 'utc');
