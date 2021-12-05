import {URL} from "url";
import Prisma from "@prisma/client";
import {requestCkey} from "@alexkar598/bab-hub";
import rTracer from "cls-rtracer";
import config from "config";
import express, {NextFunction, Request, Response} from "express";
import expressAsyncHandler from "express-async-handler";
import {prismaDb} from "../db/index.js";
import {moduleLogger} from "../logger.js";
import {generateSecureString, secureCompare} from "../util/crypto.js";
import {oauth_authorize_error, oauth_token_error} from "../util/response_helpers.js";

const authRouter = express.Router();

export {authRouter};

const callbackLogger = moduleLogger("CallbackEndpoint");
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

const domain = new URL(config.get<string>("server.publicUrl")).hostname;

authRouter.get(
  "/callback",
  expressAsyncHandler(async (req, res) => {
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
          },
        },
        id: true,
        userIp: true,
        state: true,
        startDate: true,
        redirectUri: true,
        status: true,
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
        gender: "neuter",
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

    //Make a code and associate the authorization to the user data
    const code = await generateSecureString(16);
    await prismaDb.authorization.update({
      where: {
        id: authorization.id,
      },
      data: {
        code,
        status: Prisma.AuthorizationStatus.CodeIssued,
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

    //Redirect to app with code
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set("code", code);
    if (authorization.state != null) redirect.searchParams.set("state", authorization.state);

    res.redirect(redirect.toString());
    callbackLogger.info(`Issued code to ${client_id} for client ${userData.key}`);
  }),
);

const authLogger = moduleLogger("AuthorizeEndpoint");
authRouter.get(
  "/authorize",
  expressAsyncHandler(async (req, res) => {
    //Validate that no query parameters are set twice, and check for Qs memes, see RFC6749 Section 3.1
    const invalid_query_params: string[] = [];
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value !== "string") invalid_query_params.push(key);
    }
    if (invalid_query_params.length) {
      authLogger.warning(`Invalid or duplicate query parameters`, {
        queryParams: req.query,
        invalidParams: invalid_query_params,
      });
      return (
        res
          .status(400)
          //XSS protection
          .type("text/plain")
          .send(
            `Invalid query parameters: ${invalid_query_params.join(
              ", ",
            )}. Request ID: ${rTracer.id()}`,
          )
          .end()
      );
    }

    //Ignore all empty responses, see RFC6749 Section 3.1
    // eslint-disable-next-line prefer-const
    let {response_type, client_id, redirect_uri, state} = Object.fromEntries(
      Object.entries(req.query).filter(([, value]) => value !== ""),
    );

    //Validate client exists
    const unknownClientId = () => {
      authLogger.warning(`Unknown client`, {
        client_id: client_id,
      });
      return (
        res
          .status(400)
          //XSS protection
          .type("text/plain")
          .send(`Invalid client_id: ${client_id}. Request ID: ${rTracer.id()}`)
          .end()
      );
    };
    if (typeof client_id !== "string") return unknownClientId();
    const client = await prismaDb.client.findUnique({
      where: {clientId: client_id},
      select: {redirectUris: true},
    });
    if (!client) return unknownClientId();

    //RFC6749 Section 3.1.2.3 states that the redirect_uri parameter is only required
    // when no redirect uris are registered or more than one is registered
    if (redirect_uri === undefined && client.redirectUris.length === 1) {
      redirect_uri = client.redirectUris[0];
    }

    //Validate that redirect_uri is valid
    if (
      redirect_uri === undefined ||
      typeof redirect_uri !== "string" ||
      (!client.redirectUris.includes(redirect_uri) &&
        config.get<boolean>("security.enforce_redirect_uri"))
    ) {
      authLogger.warning(`Invalid redirect_uri`, {
        client_id: client_id,
        redirect_uri: redirect_uri,
      });
      return (
        res
          .status(400)
          //XSS protection
          .type("text/plain")
          .send(`Invalid redirect_uri: ${redirect_uri}. Request ID: ${rTracer.id()}`)
          .end()
      );
    }

    //We have validated enough of the request to know the redirect_uri is valid. From now on, errors go back to the app
    req.redirect_uri = redirect_uri;

    //Validate state
    if (typeof state !== "string" && state !== undefined) {
      authLogger.warning("Invalid state", {
        state,
      });
      return oauth_authorize_error(
        res,
        req.redirect_uri,
        "invalid_request",
        "State is not a string.",
        null,
      );
    }

    //We only support code flow
    if (response_type != "code") {
      authLogger.warning("Invalid response type", {
        response_type,
      });
      return oauth_authorize_error(
        res,
        req.redirect_uri,
        "unsupported_response_type",
        "BAB only supports the authorization code flow.",
        state,
      );
    }

    //Leaving the spec and entering our implementation code

    //Save information about the login attempt
    const {byondState} = await prismaDb.authorization.create({
      data: {
        state: state,
        redirectUri: req.redirect_uri,
        client: {
          connect: {clientId: client_id},
        },
        userIp: req.ip,
      },
    });

    const publicUrl = config.get<string>("server.publicUrl");
    let byondUrl;
    if (config.get<string>("security.test")) {
      byondUrl = new URL("/test", publicUrl);
    } else {
      byondUrl = new URL("https://secure.byond.com/login.cgi");
    }
    const innerUrl = new URL("auth/callback", publicUrl);

    innerUrl.searchParams.set("byond_state", byondState);
    innerUrl.searchParams.set("client_id", client_id);

    byondUrl.searchParams.set("login", "1");
    byondUrl.searchParams.set("url", innerUrl.toString());

    res.redirect(byondUrl.toString());
    authLogger.info(`Started authorization process for client ${client_id}`);
  }),
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
authRouter.use("/authorize", (err: unknown, req: Request, res: Response, next: NextFunction) => {
  const errstr = `An internal server error occured. Please contact the application owner.`;
  if (req.redirect_uri != undefined) {
    oauth_authorize_error(res, req.redirect_uri, "server_error", errstr, null);
  } else {
    res
      .status(500)
      .send(errstr + ` Request ID: ${rTracer.id()}`)
      .end();
  }
  next(err);
});

const tokenLogger = moduleLogger("TokenEndpoint");
authRouter.post(
  "/token",
  expressAsyncHandler(async (req, res) => {
    const {
      grant_type,
      code,
      redirect_uri,
      client_id: param_client_id,
      client_secret: param_client_secret,
    } = req.body;

    //Validate parameters
    if (typeof grant_type !== "string") {
      tokenLogger.warning(`grant_type is not a string`, {grant_type});
      return oauth_token_error(res, "invalid_request", `grant_type is not a string`);
    }
    if (typeof code !== "string") {
      tokenLogger.warning(`code is not a string`, {code});
      return oauth_token_error(res, "invalid_request", `code is not a string`);
    }
    if (typeof redirect_uri !== "string") {
      tokenLogger.warning(`redirect_uri is not a string`, {redirect_uri});
      return oauth_token_error(res, "invalid_request", `redirect_uri is not a string`);
    }
    if (typeof param_client_id !== "string" && param_client_secret !== undefined) {
      tokenLogger.warning(`client_id is not a string`, {param_client_secret});
      return oauth_token_error(res, "invalid_request", `client_id is not a string`);
    }
    //We also support http basic auth, we'll check for proper auth later, for now, allow client_secret
    if (typeof param_client_secret !== "string" && param_client_secret !== undefined) {
      tokenLogger.warning(`client_secret is not a string`, {param_client_secret});
      return oauth_token_error(res, "invalid_request", `client_secret is not a string or null`);
    }

    //Validate grant_type
    if (grant_type !== "authorization_code") {
      tokenLogger.warning('grant_type is not "authorization_code"', {grant_type});
      return oauth_token_error(
        res,
        "unsupported_grant_type",
        "BAB only supports the authorization code flow",
      );
    }

    let client_id = param_client_id;
    let client_secret = param_client_secret;
    const authHeader = req.headers.authorization;

    if (authHeader?.substring(0, 6) === "Basic ") {
      const combo = Buffer.from(authHeader.substring(6), "base64").toString();
      const [username, password] = combo.split(":", 2);
      if (username !== undefined && password !== undefined) {
        client_id = username;
        client_secret = password;
      }
    }

    if (client_id === undefined) {
      tokenLogger.warning("Attempted to call token endpoint without a client_id", {
        body: req.body,
        authHeader,
      });
      return res.status(401).setHeader("WWW-Authenticate", "Basic").end();
    }

    //Fetch the client
    const client = await prismaDb.client.findUnique({
      where: {
        clientId: client_id,
      },
      select: {
        client_secret: true,
        type: true,
      },
    });

    //Check that the client exists
    if (!client) {
      tokenLogger.warning("Client not found", {client_id});
      return oauth_token_error(res, "unsupported_grant_type", "Unknown client_id");
    }
    //Validate client authentication
    if (client.type === Prisma.ClientType.Confidential) {
      if (client_secret === undefined) {
        tokenLogger.warning("Attempted to call token endpoint without a client_secret", {
          body: req.body,
        });
        return res.status(401).setHeader("WWW-Authenticate", "Basic").end();
      }
      if (client.client_secret === null || !secureCompare(client.client_secret, client_secret)) {
        tokenLogger.warning("Invalid client secret", {
          expected: client.client_secret,
          provided: client_secret,
        });
        return oauth_token_error(res, "invalid_client", "Invalid client secret");
      }
    }

    //Fetch the authorization
    const authorization = await prismaDb.authorization.findUnique({
      where: {
        code,
      },
      select: {
        id: true,
        status: true,
        clientId: true,
        redirectUri: true,
        ckey: true,
        endDate: true,
      },
    });

    const time5minsago = Date.now() - 5 * 60 * 1000;

    if (
      !authorization ||
      authorization.status !== Prisma.AuthorizationStatus.CodeIssued ||
      (authorization.endDate ?? 0) < time5minsago
    ) {
      tokenLogger.warning("Invalid or expired code", {code, authorization});
      return oauth_token_error(res, "invalid_grant", "Invalid code");
    }

    await prismaDb.authorization.update({
      where: {
        id: authorization.id,
      },
      data: {
        status: Prisma.AuthorizationStatus.Completed,
      },
    });

    if (authorization.clientId !== client_id) {
      tokenLogger.warning("Code for wrong client", {
        code,
        expected_client: authorization.clientId,
        provided_client: client_id,
      });
      tokenLogger.crit("Suspicious behvaiour");
      return oauth_token_error(res, "invalid_grant", "Code for wrong client");
    }

    if (authorization.redirectUri !== redirect_uri) {
      tokenLogger.warning("Invalid redirect_uri", {
        expected_uri: authorization.redirectUri,
        provided_uri: redirect_uri,
      });
      return oauth_token_error(res, "invalid_grant", "Invalid redirect_uri");
    }
    const username = authorization.ckey;

    //TODO: Implement OIDC, this is not secure at all.

    res.type("json").json({
      access_token: Buffer.from(`${username}`).toString("base64"),
      token_type: "bearer",
    });
    tokenLogger.info(`Issued token to ${client_id} for ${authorization.ckey} `);
  }),
);
