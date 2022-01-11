import Prisma from "@prisma/client";
import {calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, JWK, KeyLike} from "jose";
import {prismaDb} from "../db/index.js";
import {moduleLogger} from "../logger.js";

const keyController = moduleLogger("KeyController");

async function generateNewKey(): Promise<Prisma.SigningKey> {
  const disableOldKey = prismaDb.signingKey.updateMany({
    where: {
      active: true,
    },
    data: {
      active: null,
      private: {},
    },
  });
  const {publicKey: _publicKey, privateKey: _privateKey} = await generateKeyPair("RS256");
  const publicKey = await exportJWK(_publicKey);
  const privateKey = await exportJWK(_privateKey);
  publicKey.alg = "RS256";
  publicKey.use = "sig";
  const kid = await calculateJwkThumbprint(publicKey);
  publicKey.kid = kid;
  privateKey.kid = kid;
  const createNewKey = prismaDb.signingKey.create({
    data: {
      active: true,
      id: kid,
      //@ts-expect-error ts does not play nice with JWK
      private: privateKey,
      //@ts-expect-error ts does not play nice with JWK
      public: publicKey,
    },
  });
  const [, newKey] = await prismaDb.$transaction([disableOldKey, createNewKey]);
  return newKey;
}

export type SigningKey = Prisma.SigningKey & {
  importedPrivate: KeyLike | Uint8Array;
  importedPublic: KeyLike | Uint8Array;
};

async function getActiveKey(): Promise<SigningKey> {
  let key = await prismaDb.signingKey.findUnique({
    where: {
      active: true,
    },
  });
  const time3daysago = Date.now() - 3 * 24 * 60 * 60 * 1000;
  if (key === null || key.createdTime.valueOf() < time3daysago) {
    keyController.info("There are no valid keys. Generating new signing key");
    key = await generateNewKey();
  }
  const transformedKey = key as SigningKey;
  transformedKey.importedPublic = await importJWK(transformedKey.public as JWK, "RS256");
  transformedKey.importedPrivate = await importJWK(transformedKey.private as JWK, "RS256");
  return transformedKey;
}

async function processOldKeys() {
  keyController.info("Deleting old keys");
  const time15daysago = Date.now() - 15 * 24 * 60 * 60 * 1000;
  await prismaDb.signingKey.deleteMany({
    where: {
      createdTime: {
        lt: new Date(time15daysago).toISOString(),
      },
    },
  });
}

let registered = false;
function registerKeyController() {
  if (registered) throw Error("Attempted to register key controller twice");
  registered = true;

  function asyncWrapper() {
    processOldKeys().catch(e => {
      keyController.crit("Error occured while running key controller", {e});
    });
  }
  //1 hour
  setInterval(asyncWrapper, 60 * 60 * 1000);
  setImmediate(asyncWrapper);
}

export {registerKeyController, generateNewKey, getActiveKey};
