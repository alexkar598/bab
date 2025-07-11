import {URL} from "url";
import config from "config";

export const domain = new URL(config.get<string>("server.publicUrl")).hostname;
export const promptTypes: {
  none: "none";
  login: "login";
  consent: "consent";
  select_account: "select_account";
} = {
  none: "none",
  login: "login",
  consent: "consent",
  select_account: "select_account",
};
export type promptTypes = (typeof promptTypes)[keyof typeof promptTypes];
export const supportedScopes = ["openid"];
