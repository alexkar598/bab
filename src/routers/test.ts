import {URL} from "url";
import {resolve} from "path";
import config from "config";
import express from "express";
import {dirname} from "../index.js";

const testRouter = express.Router();

export {testRouter};

if (config.get<boolean>("security.test"))
  testRouter
    .route("/")
    .get((_, res) => {
      res.sendFile(resolve(dirname(import.meta.url), "../html/testbyond.html"));
    })
    .post(express.json())
    .post((req, res) => {
      const url = req.query.url as string;
      const redirectUrl = new URL(url);
      redirectUrl.searchParams.set("byondcert", req.body.username);
      redirectUrl.searchParams.set("byondcertexp", "");
      res.redirect(redirectUrl.toString());
    });

testRouter.get("/client", (_, res) => {
  res.sendFile(resolve(dirname(import.meta.url), "../html/testclient.html"));
});
