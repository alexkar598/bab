import {expressMiddleware as RIdMiddleWare} from "cls-rtracer";
import config from "config";
import express, {NextFunction, Request, Response} from "express";
import expressWinston from "express-winston";
import registerRouters from "./routers/index.js";
import {moduleLogger} from "./logger.js";
import {registerSecurityMiddleware} from "./util/securityMiddleware.js";

const httpLogger = moduleLogger("HTTP");

const expressApp = express();

if (config.get<boolean>("security.secure")) {
  expressApp.use((req, res) => {
    if (!req.secure) res.send("Secure mode enabled. Use HTTPS or disable secure mode.").end();
  });
}

expressApp.set("trust proxy", config.get<string | number | boolean>("server.proxy"));

expressApp.use(express.urlencoded({extended: false}));
expressApp.use(RIdMiddleWare({echoHeader: true}));
expressApp.use(
  expressWinston.logger({
    winstonInstance: httpLogger,
    metaField: "http",
    msg: "{{res.responseTime}}ms {{res.statusCode}} {{req.method}} {{req.url}}",
    meta: config.get<boolean>("logging.http.meta"),
    statusLevels: {
      success: config.get<string>("logging.http.level"),
      warn: "warning",
      error: "error",
    },
  }),
);

registerSecurityMiddleware(expressApp);
registerRouters(expressApp);

expressApp.use(
  expressWinston.errorLogger({
    winstonInstance: httpLogger,
    msg: "{{req.method}} {{req.url}} {{err}}",
    blacklistedMetaFields: ["exception", "trace", "date", "os"],
    metaField: null,
    dynamicMeta: (req, res, err) => {
      return {
        error: err,
      };
    },
  }),
);

//needed for error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
expressApp.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  //Don't write to the request if its already been closed
  if (!res.writableEnded) {
    res.status(500).send("Error occured in application. Contact application owner.").end();
  }
});

export function registerServer() {
  return new Promise((resolve, reject) => {
    let string_port: string | undefined = config.get<string>("server.port");
    // Test for alphanumericity by checking if the string -> int -> string conversion is lossless
    if (String(parseInt(string_port)) !== string_port) {
      string_port = process.env[string_port];
    }

    if (string_port == null) {
      httpLogger.error(`Unable to use ${string_port} from environment variable`);
      reject("Unable to listen");
      return;
    }

    const port = parseInt(string_port);

    const expressServer = expressApp.listen(port, config.get<string>("server.host"), () => {
      httpLogger.info(`Listening on ${port}`);
      resolve(port);
    });
    expressServer.on("error", e => {
      httpLogger.error(`Unable to listen on ${port}:`, e);
      reject(e);
    });

    process.on("SIGTERM", () => {
      httpLogger.info("Received stop signal. Goodbye.");
      expressServer.close();
    });
  });
}
