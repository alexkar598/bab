import Prisma from "@prisma/client";
import expressAsyncHandler from "express-async-handler";
import {prismaDb} from "../../db/index.js";
import {moduleLogger} from "../../logger.js";
import {secureCompare} from "../../util/crypto.js";
import {oauth_token_error} from "../../util/responseHelpers.js";

const tokenLogger = moduleLogger("TokenEndpoint");
const tokenEndpoint = expressAsyncHandler(async (req, res) => {
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
      clientSecret: true,
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
    if (client.clientSecret === null || !secureCompare(client.clientSecret, client_secret)) {
      tokenLogger.warning("Invalid client secret", {
        expected: client.clientSecret,
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
  tokenLogger.info(`Issued token to "${authorization.ckey}" for client "${client_id}"`);
});
export {tokenEndpoint};
