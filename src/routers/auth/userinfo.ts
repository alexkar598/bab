import config from "config";
import {Request, Response} from "express";
import expressAsyncHandler from "express-async-handler";
import {importJWK, JWK, jwtVerify} from "jose";
import {prismaDb} from "../../db/index.js";
import {moduleLogger} from "../../logger.js";

const userInfoLogger = moduleLogger("userInfo");
const userInfoEndpoint = expressAsyncHandler(async (req: Request, res: Response) => {
  function errorResponse(
    error: "invalid_request" | "invalid_token" | "insufficient_scope",
    error_description: string,
  ) {
    res
      .status(401)
      .setHeader("WWW-Authenticate", `error="${error}",error_description="${error_description}"`)
      .end();
  }

  const authHeader = req.headers.authorization;
  if (authHeader === undefined || authHeader.substring(0, 7) != "Bearer ") {
    errorResponse("invalid_request", "Malformed authorization header");
    return;
  }

  const accessToken = authHeader.substring(7);
  let payload;
  try {
    const decodedToken = await jwtVerify(
      accessToken,
      async protectedHeader => {
        const key = await prismaDb.signingKey.findUnique({
          where: {
            id: protectedHeader.kid,
          },
          select: {
            public: true,
          },
        });
        if (!key) throw Error(`No key found for ID ${protectedHeader.kid}`);

        return await importJWK(key.public as JWK, "RS256");
      },
      {
        audience: config.get<string>("server.publicUrl"),
        issuer: config.get<string>("server.publicUrl"),
      },
    );

    payload = decodedToken.payload;
  } catch (error) {
    userInfoLogger.warning("Invalid id_token_hint", {
      error,
      accessToken,
    });
    return errorResponse("invalid_token", "Token is invalid");
  }

  res
    .status(200)
    .json({
      sub: payload.sub,
      gender: payload.gender,
      ckey: payload.ckey,
    })
    .end();
});

export {userInfoEndpoint};
