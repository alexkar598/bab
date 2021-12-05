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
  | "temporarily_unavailable";
export function oauth_authorize_error(
  response: Response,
  redirect_url: string,
  error: oauth_authorize_errors,
  error_description: string,
  state: string | undefined | null,
) {
  const url = new URL(redirect_url);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", error_description + ` Request ID: ${rTracer.id()}`);
  if (state !== undefined && state !== null) url.searchParams.set("state", state);

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
  response.json({
    error,
    error_description,
  });
}
