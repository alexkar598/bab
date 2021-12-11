import rTracer from "cls-rtracer";
import express, {NextFunction, Request, Response} from "express";
import {oauth_authorize_error} from "../../util/responseHelpers.js";
import {authorizeEndpoint} from "./authorize.js";
import {callbackEndpoint} from "./callback.js";
import {listKeysEndpoint} from "./keys.js";
import {tokenEndpoint} from "./token.js";

const authRouter = express.Router();

export {authRouter};

authRouter.get("/callback", callbackEndpoint);
authRouter.use("/callback", (err: unknown, req: Request, res: Response, next: NextFunction) => {
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

authRouter.get("/authorize", authorizeEndpoint);
authRouter.post("/authorize", authorizeEndpoint);

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

authRouter.post("/token", tokenEndpoint);
authRouter.use("/token", (err: unknown, req: Request, res: Response, next: NextFunction) => {
  const errstr = `An internal server error occured. Please contact the application owner. Request ID: ${rTracer.id()}`;
  res.status(500).send(errstr).end();
  next(err);
});

authRouter.get("/keys", listKeysEndpoint);
