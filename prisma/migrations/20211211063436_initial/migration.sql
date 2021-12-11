-- Manual Edits
CREATE EXTENSION "pgcrypto";

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('Public', 'Confidential');

-- CreateEnum
CREATE TYPE "ResponseMode" AS ENUM ('query', 'fragment');

-- CreateEnum
CREATE TYPE "ResponseTypes" AS ENUM ('code', 'id_token', 'none');

-- CreateEnum
CREATE TYPE "PromptOptions" AS ENUM ('none', 'login', 'consent', 'select_account');

-- CreateEnum
CREATE TYPE "AuthorizationStatus" AS ENUM ('Created', 'CodeIssued', 'Completed');

-- CreateTable
CREATE TABLE "Client" (
    "clientId" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "contactInfo" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT E'Confidential',
    "clientSecret" TEXT,
    "allowedTokenGrant" BOOLEAN NOT NULL DEFAULT false,
    "expiry" INTEGER NOT NULL DEFAULT 10080,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "Authorization" (
    "id" SERIAL NOT NULL,
    "status" "AuthorizationStatus" NOT NULL DEFAULT E'Created',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT (now() at time zone 'utc'),
    "endDate" TIMESTAMP(3),
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "state" TEXT,
    "responseMode" "ResponseMode" NOT NULL,
    "responseTypes" "ResponseTypes"[],
    "scopes" TEXT[],
    "nonce" TEXT,
    "subClaim" TEXT,
    "userIp" INET NOT NULL,
    "byondState" TEXT NOT NULL DEFAULT substring(gen_random_bytes(24)::text FROM 3),
    "ckey" TEXT,
    "code" TEXT,

    CONSTRAINT "Authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserData" (
    "ckey" TEXT NOT NULL,
    "gender" TEXT NOT NULL,

    CONSTRAINT "UserData_pkey" PRIMARY KEY ("ckey")
);

-- CreateTable
CREATE TABLE "ByondCert" (
    "encodedCert" TEXT NOT NULL DEFAULT substring(gen_random_bytes(24)::text FROM 3),
    "byondState" TEXT NOT NULL,
    "byondCert" TEXT NOT NULL,
    "clientIp" TEXT NOT NULL,
    "createdTime" TIMESTAMP(3) NOT NULL DEFAULT (now() at time zone 'utc'),

    CONSTRAINT "ByondCert_pkey" PRIMARY KEY ("encodedCert")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "private" JSONB NOT NULL,
    "public" JSONB NOT NULL,
    "id" TEXT NOT NULL,
    "active" BOOLEAN,
    "createdTime" TIMESTAMP(3) NOT NULL DEFAULT (now() at time zone 'utc'),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_byondState_key" ON "Authorization"("byondState");

-- CreateIndex
CREATE UNIQUE INDEX "Authorization_code_key" ON "Authorization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ByondCert_byondState_byondCert_key" ON "ByondCert"("byondState", "byondCert");

-- CreateIndex
CREATE UNIQUE INDEX "SigningKey_active_key" ON "SigningKey"("active");

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_ckey_fkey" FOREIGN KEY ("ckey") REFERENCES "UserData"("ckey") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Authorization" ADD CONSTRAINT "Authorization_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("clientId") ON DELETE RESTRICT ON UPDATE CASCADE;
