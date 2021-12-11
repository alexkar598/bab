import {URL, URLSearchParams} from "url";
import {SignJWT} from "jose";
import {requestCkey} from "@alexkar598/bab-hub";
import Prisma from "@prisma/client";
import rTracer from "cls-rtracer";
import config from "config";
import expressAsyncHandler from "express-async-handler";
import {getActiveKey} from "../../controllers/keyController.js";
import {prismaDb} from "../../db/index.js";
import {moduleLogger} from "../../logger.js";
import {domain} from "../../util/constants.js";
import {generateOIDCHash, generateSecureString, secureCompare} from "../../util/crypto.js";
import {oauth_authorize_error} from "../../util/responseHelpers.js";

export const callbackLogger = moduleLogger("CallbackEndpoint");

/*
//Middleware to supress warnings about logging in to a website that does not support authentication
authRouter.use("/callback", (req, res, next) => {
  if (!req.headers.authorization) {
    console.log("Requesting authentication");
    res.setHeader("WWW-Authenticate", "Basic");
    res.sendStatus(401);
  } else {
    next();
  }
});
 */

const callbackEndpoint = expressAsyncHandler(async (req, res) => {
  function returnError(error: string) {
    res
      .status(400)
      //XSS protection
      .type("text/plain")
      .send(`${error} Request ID: ${rTracer.id()}`)
      .end();
  }

  const client_id = req.query.client_id;

  /*
  //Validate authorization header exists
  if (!req.headers.authorization) {
    callbackLogger.warning("Authorization header is missing");
    return returnError(`Authorization header is missing.`);
  }

  //Validate that is a basic authorization
  if (req.headers.authorization.substring(0, 6) !== "Basic ") {
    callbackLogger.warning("Authorization header is invalid", {
      header: req.headers.authorization,
    });
    return returnError(
      `Authorization header is invalid. Authorization header: ${req.headers.authorization}.`,
    );
  }

  //Parse the authorization header
  const [username] = Buffer.from(req.headers.authorization.substring(6), "base64")
    .toString()
    .split(":", 1);
  const [client_id, byondState] = username.split(":", 2);
  */

  //Validate byondstate
  const byondState = req.query.byond_state;
  if (typeof byondState !== "string") {
    callbackLogger.warning("byondState is invalid", {byondState});
    return returnError("byondState is invalid.");
  }

  //Validate encodedcert
  const encodedCert = req.query.encoded_cert;
  if (typeof encodedCert !== "string") {
    callbackLogger.warning("encodedCert is invalid", {encodedCert});
    return returnError("encodedCert is invalid.");
  }

  const decodedCert = await prismaDb.byondCert.findUnique({
    where: {
      encodedCert,
    },
    select: {
      byondState: true,
      byondCert: true,
      clientIp: true,
    },
  });

  //Validate that the cert exists
  if (!decodedCert) {
    callbackLogger.warning("encodedCert is invalid", {encodedCert});
    return returnError("encodedCert is invalid.");
  }

  await prismaDb.byondCert.delete({
    where: {
      encodedCert,
    },
  });

  //Validate that the ip matches
  if (decodedCert.clientIp !== req.ip) {
    callbackLogger.warning("clientIp mismatch", {
      expected: decodedCert.byondState,
      provided: byondState,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return returnError("Client IP mismatch.");
  }

  //Validate that the state is matching
  if (!secureCompare(decodedCert.byondState, byondState)) {
    callbackLogger.warning("byondState mismatch", {
      expected: decodedCert.byondState,
      provided: byondState,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return returnError("byondState mismatch.");
  }

  //Validate the actual byondCert, if you remember right, we don't check it in securityMiddleware, we just encode it
  const byondCert = JSON.parse(decodedCert.byondCert);
  if (typeof byondCert !== "string") {
    callbackLogger.warning("byondCert is invalid", {
      byondCert: byondCert,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return returnError("byondCert is invalid.");
  }

  //Fetch the authorization object
  const authorization = await prismaDb.authorization.findUnique({
    select: {
      client: {
        select: {
          clientId: true,
          expiry: true,
          disabled: true,
        },
      },
      id: true,
      userIp: true,
      state: true,
      startDate: true,
      redirectUri: true,
      status: true,
      responseMode: true,
      responseTypes: true,
      nonce: true,
      subClaim: true,
    },
    where: {
      byondState: byondState,
    },
  });

  //Check that we received an object
  if (!authorization) {
    callbackLogger.warning("Can't find authorization request", {
      byondState: byondState,
    });
    return returnError("Unable to find authorization request");
  }

  //Check that the authorization header client_id matches the one in the authorization object
  if (authorization.client.clientId != client_id) {
    callbackLogger.warning("client_id mismatch", {
      authorization: authorization,
      client_id,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return returnError(`client_id mismatch. Got ${client_id}`);
  }

  if (authorization.client.disabled !== null) {
    callbackLogger.warning("client is disabled", {
      client_id,
    });
    return returnError(
      `The client "${client_id}" is disabled for the following reason: ${authorization.client.disabled}`,
    );
  }
  req.redirect_uri = authorization.redirectUri;

  //Check that the user hasn't changed IPs (uh oh) between /authorize and /callback
  if (authorization.userIp != req.ip) {
    callbackLogger.warning("IP mismatch", {
      expected_ip: authorization.userIp,
      provided_ip: req.ip,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "access_denied",
      "IP mismatch between authorization initiator and finisher.",
      authorization.state,
    );
  }

  //Check that the authorization request isn't being used twice
  if (authorization.status !== Prisma.AuthorizationStatus.Created) {
    callbackLogger.warning("Authorization is already completed", {
      authorization,
    });
    callbackLogger.crit("Suspicious behvaiour");
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "access_denied",
      "Authorization request is already complete.",
      authorization.state,
    );
  }

  //Check that the authorization request isn't too old
  const timestamp15minsago = Date.now() - 15 * 60 * 1000;
  if (authorization.startDate.valueOf() < timestamp15minsago) {
    callbackLogger.warning("Authorization is too old", {
      authorization,
    });
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "access_denied",
      "Authorization request is too old.",
      authorization.state,
    );
  }

  //Fetches the userdata either from byond or the test client
  let userData;
  if (config.get<boolean>("security.test")) {
    //Cert == ckey
    userData = {
      valid: true,
      key: byondCert,
      gender: "test",
    };
  } else {
    //Fetch user data from BYOND
    userData = await requestCkey(byondCert, domain);
  }

  //Nope
  if (!userData.valid) {
    callbackLogger.warning("Hub does not recognize certificate", {byondCert, domain});
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "access_denied",
      "Hub does not recognize certificate",
      authorization.state,
    );
  }

  //Sub claim
  if (authorization.subClaim !== null && authorization.subClaim !== userData.key) {
    callbackLogger.warning("Another user is logged in", {byondCert, domain});
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "login_required",
      "Another user is logged in and the client has made a sub claim.",
      authorization.state,
    );
  }

  //Make a code and associate the authorization to the user data
  const code = (authorization.responseTypes.includes("code") as boolean)
    ? await generateSecureString(24)
    : null;
  await prismaDb.authorization.update({
    where: {
      id: authorization.id,
    },
    data: {
      code,
      status: (authorization.responseTypes.includes("code") as boolean)
        ? "CodeIssued"
        : "Completed",
      endDate: new Date(),
      userData: {
        connectOrCreate: {
          where: {
            ckey: userData.key,
          },
          create: {
            ckey: userData.key,
            gender: userData.gender,
          },
        },
      },
    },
  });
  await prismaDb.userData.update({
    where: {
      ckey: userData.key,
    },
    data: {
      gender: userData.gender,
    },
  });

  let id_token;
  if (authorization.responseTypes.includes("id_token")) {
    const key = await getActiveKey();

    callbackLogger.info("Issuing ID token via hybrid/implicit flow");
    id_token = await new SignJWT({
      iss: config.get<string>("server.publicUrl"),
      sub: `user:${userData.key}`,
      ckey: userData.key,
      aud: client_id,
      exp: new Date().valueOf() + authorization.client.expiry * 1000,
      iat: new Date().valueOf(),
      auth_time: new Date().valueOf(),
      nonce: authorization.nonce,
      azp: client_id,
      c_hash: code !== null ? generateOIDCHash(code) : undefined,
      gender: userData.gender,
    })
      .setProtectedHeader({
        alg: "RS256",
        kid: key.id,
        type: "JOSE",
      })
      .sign(key.importedPrivate);
  }

  //Redirect to app with code
  const redirect = new URL(authorization.redirectUri);

  //Query response mode
  if (authorization.responseMode === Prisma.ResponseMode.query) {
    /*Code Grant*/ if (code !== null) redirect.searchParams.set("code", code);
    /*State*/ if (authorization.state != null)
      redirect.searchParams.set("state", authorization.state);

    //Fragment response mode
  } else if (authorization.responseMode === Prisma.ResponseMode.fragment) {
    const fragmentParams = new URLSearchParams();

    /*Code Grant*/ if (code !== null) fragmentParams.set("code", code);
    /*State*/ if (authorization.state != null) fragmentParams.set("state", authorization.state);
    /*ID Token*/ if (id_token !== undefined) fragmentParams.set("id_token", id_token);

    redirect.hash = fragmentParams.toString();
    //Invalid response mode
  } else {
    callbackLogger.warning("callback does not recognize response_mode", {
      response_mode: authorization.responseMode,
    });
    return oauth_authorize_error(
      res,
      authorization.redirectUri,
      "access_denied",
      "callback does not recognize response_mode",
      authorization.state,
    );
  }

  res.redirect(redirect.toString());
  callbackLogger.info(`Issued code to "${userData.key}" for client "${client_id}"`);
});

export {callbackEndpoint};
