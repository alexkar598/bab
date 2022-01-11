import {URL} from "url";
import {importJWK, JWK, jwtVerify} from "jose";
import Prisma from "@prisma/client";
import rTracer from "cls-rtracer";
import config from "config";
import expressAsyncHandler from "express-async-handler";
import {prismaDb} from "../../db/index.js";
import {moduleLogger} from "../../logger.js";
import {promptTypes} from "../../util/constants.js";
import {oauth_authorize_error} from "../../util/responseHelpers.js";

const authLogger = moduleLogger("AuthorizeEndpoint");
const authorizeEndpoint = expressAsyncHandler(async (req, res) => {
  if (req.headers["user-agent"]?.includes("Discordbot"))
    return res
      .status(200)
      .type("text/plain")
      .send("User-Agent contains DiscordBot. Ignoring request")
      .end();

  const raw_params = req.method === "GET" ? req.query : req.body;

  //Validate that no query parameters are set twice, and check for Qs memes, see RFC6749 Section 3.1
  const invalid_query_params: string[] = [];
  for (const [key, value] of Object.entries(raw_params)) {
    if (typeof value !== "string") invalid_query_params.push(key);
  }

  if (invalid_query_params.length) {
    authLogger.warning(`Invalid or duplicate query parameters`, {
      queryParams: raw_params,
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
  const {
    response_type: _response_type,
    client_id,
    state,
    response_mode: _response_mode,
    scope: _scope,
    prompt: _prompt,
    nonce,
    redirect_uri,
    registration,
    request,
    request_uri,
    id_token_hint,
  } = Object.fromEntries(
    Object.entries(raw_params as Record<string, string | undefined>).filter(
      ([, value]) => value !== "",
    ),
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
  if (client_id === undefined) return unknownClientId();
  const client = await prismaDb.client.findUnique({
    where: {clientId: client_id},
    select: {redirectUris: true, allowedTokenGrant: true, disabled: true},
  });
  if (!client) return unknownClientId();

  if (client.disabled !== null) {
    authLogger.warning(`Client is disabled`, {
      client_id,
    });
    return (
      res
        .status(400)
        //XSS protection
        .type("text/plain")
        .send(
          `The client "${client_id}" has been disabled for the following reason: ${client.disabled}.`,
        )
        .end()
    );
  }

  //Validate that redirect_uri is valid
  if (
    redirect_uri === undefined ||
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

  //Set sub claim
  let subClaim = null;
  if (id_token_hint !== undefined) {
    try {
      const decodedToken = await jwtVerify(id_token_hint, async protectedHeader => {
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
      });

      subClaim = decodedToken.payload.sub;
    } catch (error) {
      authLogger.warning("Invalid id_token_hint", {
        error,
        id_token_hint,
      });
      return oauth_authorize_error(
        res,
        req.redirect_uri,
        "invalid_request",
        "Invalid id_token_hint",
        null,
      );
    }
  }

  //https://openid.net/specs/oauth-v2-multiple-response-types-1_0.html Section 2.1 Response Modes
  if (_response_mode !== undefined && !(_response_mode in Prisma.ResponseMode)) {
    authLogger.warning("Invalid response_mode", {
      response_mode: _response_mode,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "invalid_request",
      "response_mode is not 'query' or 'fragment'.",
      null,
    );
  }

  //Parse scopes and set scope to openid if undefined
  const scopes = _scope?.split(" ") ?? null;

  //Validate that scopes include openid
  if (!scopes?.includes("openid")) {
    authLogger.warning("scope is lacking openid scope", {scopes});
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "invalid_request",
      "BAB only supports requests with the openid scope",
      state,
    );
  }

  //Validate response type is present
  if (_response_type === undefined) {
    authLogger.warning("Response type is required", {_response_type});
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "invalid_request",
      "response_type is required.",
      state,
    );
  }

  const _response_types = _response_type.split(" ");

  //Validate response_type to be a valid value
  if (
    _response_types.length === 0 ||
    _response_types.some(value => !(value in Prisma.ResponseTypes))
  ) {
    authLogger.warning("Invalid response types", {
      _response_types,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "unsupported_response_type",
      "BAB does not support some or all of the provided response types.",
      state,
    );
  }
  const response_types = _response_types as Prisma.ResponseTypes[];

  //Token grant whitelist
  if (response_types.includes("id_token") && !(client.allowedTokenGrant as boolean)) {
    authLogger.warning(
      "Attempted to use ID token grant for client without support for ID token grant",
      {client_id, response_types},
    );
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "unsupported_response_type",
      "client is not whitelisted for ID token grant",
      state,
    );
  }

  //Error if registration is set
  if (registration !== undefined) {
    authLogger.warning("Attempted to make use of registration parameter", {
      registration,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "registration_not_supported",
      "Registration parameter is not supported",
      state,
    );
  }

  //Validate prompt
  if (_prompt !== undefined && !(_prompt in promptTypes)) {
    authLogger.warning("Unknown prompt type", {prompt: _prompt});
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "invalid_request",
      "prompt has an invalid value",
      state,
    );
  }
  const prompt = _prompt as promptTypes | undefined;

  //Return proper error for prompt since we support none of the values
  if (prompt !== undefined) {
    authLogger.warning("Returning error for prompt", {prompt});
    switch (prompt) {
      case "select_account":
        return oauth_authorize_error(
          res,
          req.redirect_uri,
          "account_selection_required",
          "BAB does not support any prompt parameter values",
          state,
        );
      case "none":
        return oauth_authorize_error(
          res,
          req.redirect_uri,
          "interaction_required",
          "BAB does not support any prompt parameter values",
          state,
        );
      case "login":
        return oauth_authorize_error(
          res,
          req.redirect_uri,
          "login_required",
          "BAB does not support any prompt parameter values",
          state,
        );
      case "consent":
        return oauth_authorize_error(
          res,
          req.redirect_uri,
          "consent_required",
          "BAB does not support any prompt parameter values",
          state,
        );
    }
  }

  //RFC says we need to throw an erorr if it's not supported
  if (request !== undefined) {
    authLogger.warning("request parameter is not supported", {
      request,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "request_not_supported",
      "The request parameter is not supported.",
      state,
    );
  }

  //RFC says we need to throw an erorr if it's not supported
  if (request_uri !== undefined) {
    authLogger.warning("request_uri parameter is not supported", {
      request,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "request_uri_not_supported",
      "The request_uri parameter is not supported.",
      state,
    );
  }

  let response_mode = _response_mode as Prisma.ResponseMode | undefined;
  //Default response modes
  if (response_mode === undefined) {
    //ID token says default is "fragment", code and none is "query"
    if (response_types.includes("id_token")) {
      response_mode = "fragment";
    } else {
      response_mode = "query";
    }
  }

  //Check if id_token response_type has response_mode query (and deny)
  if (response_types.includes("id_token") && response_mode === "query") {
    authLogger.warning("Query response mode must not be used for id_token response type", {
      response_types,
      response_mode,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "unsupported_response_type",
      "Query response mode must not be used for id_token response type.",
      state,
    );
  }

  //Check if id_token response_type has response_mode query (and deny)
  if (response_types.includes("id_token") && nonce === undefined) {
    authLogger.warning("Nonce required for id_token claim.", {
      response_types,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "unsupported_response_type",
      "Nonce required for id_token claim.",
      state,
    );
  }

  //None should not be combined with other response types
  if (response_types.includes(Prisma.ResponseTypes.none) && response_types.length >= 2) {
    authLogger.warning("Attempted to combine response_type none with other response_types", {
      response_types,
    });
    return oauth_authorize_error(
      res,
      req.redirect_uri,
      "unsupported_response_type",
      "Attempted to combine response_type none with other response_types.",
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
      responseMode: response_mode,
      responseTypes: response_types,
      scopes: scopes,
      nonce: nonce,
      subClaim: subClaim,
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
  authLogger.info(`Started authorization process for client "${client_id}"`);
});
export {authorizeEndpoint};
