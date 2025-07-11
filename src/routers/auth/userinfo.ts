import config from "config";
import {Request, Response} from "express";
import expressAsyncHandler from "express-async-handler";
import {importJWK, JWK, jwtVerify, JWTVerifyGetKey} from "jose";
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

  let accessToken: string | null = null;

  const authHeader = req.headers.authorization;
  const authParam = req.query.access_token;
  // 2.1 Authorization Request Header Field
  if (authHeader != undefined) {
    if (authHeader.substring(0, 7) != "Bearer ") {
      errorResponse("invalid_request", "Malformed authorization header");
      return;
    }

    accessToken = authHeader.substring(7);
    // 2.3 URI Query Parameter, not recommended
  } else if (authParam != undefined) {
    if (typeof authParam !== "string") {
      errorResponse("invalid_request", "Malformed access_token parameter");
      return;
    }
    res.setHeader("Cache-Control", "private");
    accessToken = authParam;
    // 2.2 Form-Encoded Body Parameter
    // Or no auth
  } else if (req.method === "POST") {
    if (req.is("application/x-www-form-urlencoded") == false) {
      errorResponse("invalid_request", "Body is not form-urlencoded");
      return;
    }

    const authField = req.body.access_token;
    if (authField == undefined) {
      errorResponse("invalid_request", "access_token field is missing");
      return;
    }
    accessToken = authField;
  }

  if (accessToken == null) {
    errorResponse("invalid_request", "No access token provided");
    return;
  }

  let payload;
  try {
    const decodedToken = await jwtVerify(
      accessToken,
      (async protectedHeader => {
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
      }) satisfies JWTVerifyGetKey,
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
