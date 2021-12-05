import {Application} from "express";
import {authRouter} from "./auth.js";
import {testRouter} from "./test.js";

export default function registerRouters(app: Application) {
  app.use("/auth", authRouter);
  app.use("/test", testRouter);
}
