import {URL} from "url";
import {Request, Response} from "express";
import config from "config";
import {supportedScopes} from "../../util/constants.js";

const publicUrl = config.get<string>("server.publicUrl");
const cachedConfig = {
  issuer: publicUrl,
  authorization_endpoint: new URL("/auth/authorize", publicUrl).toString(),
  token_endpoint: new URL("/auth/token", publicUrl).toString(),
  userinfo_endpoint: new URL("/auth/userinfo", publicUrl).toString(),
  jwks_uri: new URL("/auth/keys", publicUrl).toString(),
  //registration_endpoint: null
  scopes_supported: supportedScopes,
  response_types_supported: ["code", "id_token", "code id_token"],
  response_modes_supported: ["query", "fragment"],
  grant_types_supported: ["authorization_code", "implicit"],
  acr_values_supported: [],
  id_token_signing_alg_values_supported: ["RS256"],
  id_token_encryption_alg_values_supported: [],
  id_token_encryption_enc_values_supported: [],
  userinfo_signing_alg_values_supported: ["RS256"],
  userinfo_encryption_alg_values_supported: [],
  userinfo_encryption_enc_values_supported: [],
  request_object_signing_alg_values_supported: [],
  request_object_encryption_alg_values_supported: [],
  request_object_encryption_enc_values_supported: [],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  token_endpoint_auth_signing_alg_values_supported: ["RS256"],
  display_values_supported: [],
  claim_types_supported: ["normal"],
  claims_supported: ["gender"],
  claims_locales_supported: [],
  ui_locales_supported: [],
  claims_parameter_supported: false,
  request_parameter_supported: false,
  request_uri_parameter_supported: true,
  //require_request_uri_registration: false,
};

export function openidConfig(_request: Request, response: Response) {
  response.status(200).json(cachedConfig);
}
