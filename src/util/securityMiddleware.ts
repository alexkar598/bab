import {URL} from "url";
import rTracer from "cls-rtracer";
import config from "config";
import {Application, NextFunction, Request, Response} from "express";
import expressAsyncHandler from "express-async-handler";
import {prismaDb} from "../db/index.js";
import {moduleLogger} from "../logger.js";

const securityLogger = moduleLogger("SecurityMiddleware");
export function registerSecurityMiddleware(app: Application) {
  app.all("/byondcerterror", (req, res) => {
    res
      .status(500)
      .type("text/plain")
      .send(`An error has occured in the security middleware. ${req.query.error}`)
      .end();
  });

  //Security middleware, remove byondcert from the URL asap to prevent it from being social engineer'd out of users
  app.use(
    expressAsyncHandler(async (req, res, next) => {
      function errorRedirect(error: string) {
        const errorUrl = new URL("/byondcerterror", config.get<string>("server.publicUrl"));
        errorUrl.searchParams.set("error", error + ` Request ID: ${rTracer.id()}`);
        res.redirect(errorUrl.toString());
      }

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Frame-Options", "DENY");

      const rawbyondcert = req.query.byondcert;
      if (rawbyondcert !== undefined) {
        req.callback = true;
        //We stringify here because it could be invalid but we dont care about that, we care about hiding it from the user
        const jsonbyondcert = JSON.stringify(rawbyondcert);
        const byondState = req.query["byond_state"];
        if (typeof byondState !== "string") {
          securityLogger.warning("State is not a string", {byondState});
          return errorRedirect("State is not a string. Contact application owner");
        }

        if (
          await prismaDb.byondCert.findUnique({
            where: {
              byondState_byondCert: {
                byondState,
                byondCert: jsonbyondcert,
              },
            },
          })
        ) {
          securityLogger.warning("Cert/state combo has already been used", {
            byondState,
            byondCert: jsonbyondcert,
          });
          securityLogger.crit("Suspicious behvaiour");
          return errorRedirect("Certificate already used. Restart authentication process.");
        }

        const {encodedCert} = await prismaDb.byondCert.create({
          data: {
            byondState,
            byondCert: jsonbyondcert,
            clientIp: req.ip,
          },
        });

        res
          .type("html")
          .send(
            `  
          <!--suppress ES6ConvertVarToLetConst -->
          <script>
            try{
            var destination = new URL(window.location.href);
            destination.searchParams.delete("byondcert")
            destination.searchParams.set("encoded_cert", "${encodedCert}")
            window.location.replace(destination)
            } catch (e) {
              window.location.replace("${config.get<string>(
                "server.publicUrl",
              )}/byondcerterror/?error=${encodeURIComponent(
              "Client JS error. Request ID: " + rTracer.id(),
            )}")
            }
          </script>
          <noscript>
            This page requires Javascript. Alternatively, remove the byondcert parameter in the url and set the encoded_cert parameter to ${encodedCert}
          </noscript>
        `,
          )
          .end();
      } else {
        next();
      }
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.callback) return next(err);

    const errorUrl = new URL("/byondcerterror", config.get<string>("server.publicUrl"));
    errorUrl.searchParams.set(
      "error",
      `An unknown error has occured. Please contact the application owner. Request ID: ${rTracer.id()}`,
    );
    res.redirect(errorUrl.toString());
    next(err);
  });
}
