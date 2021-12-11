import {URL} from "url";
import rTracer from "cls-rtracer";
import {Response} from "express";

export type oauth_authorize_errors =
  | "invalid_request"
  | "unauthorized_client"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_scope"
  | "server_error"
  | "temporarily_unavailable"
  //OIDC errors
  | "interaction_required"
  | "login_required"
  | "account_selection_required"
  | "consent_required"
  | "invalid_request_uri"
  | "invalid_request_object"
  | "request_not_supported"
  | "request_uri_not_supported"
  | "registration_not_supported";

export function oauth_authorize_error(
  response: Response,
  redirect_url: string,
  error: oauth_authorize_errors,
  error_description: string,
  state: string | undefined | null,
  //I recognise the council has made a decision, but given that it's a stupid-ass decision, I've elected to ignore it.
  //The spec says response mode SHOULD apply to success and error responses but it brings
  // just so many problems so I elect to ignore it and always send it as query params
  //response_mode: Prisma.ResponseMode,
) {
  const url = new URL(redirect_url);
  //if (response_mode === Prisma.ResponseMode.query) {
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", error_description + ` Request ID: ${rTracer.id()}`);
  if (state !== undefined && state !== null) url.searchParams.set("state", state);
  /*} else if (response_mode == Prisma.ResponseMode.fragment) {
    const responseparams = new URLSearchParams();
    responseparams.set("error", error);
    responseparams.set("error_description", error_description + ` Request ID: ${rTracer.id()}`);
    if (state !== undefined && state !== null) responseparams.set("state", state);

    url.hash = responseparams.toString();
  } else {
    throw Error("unknown response_mode " + response_mode);
  }*/

  response.redirect(url.toString());
}

export type oauth_token_errors =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope";
export function oauth_token_error(
  response: Response,
  error: oauth_token_errors,
  error_description: string,
) {
  response.status(400).json({
    error,
    error_description: error_description + ` Request ID: ${rTracer.id()}`,
  });
}
