import expressAsyncHandler from "express-async-handler";
import {prismaDb} from "../../db/index.js";

const listKeysEndpoint = expressAsyncHandler(async (_, res) => {
  const keys = await prismaDb.signingKey.findMany();
  const publicKeys = keys.map(key => key.public);
  res.status(200).json({keys: publicKeys});
});
export {listKeysEndpoint};
