declare module "express-serve-static-core" {
  // noinspection JSUnusedGlobalSymbols
  interface Request {
    redirect_uri?: string;
    callback?: boolean;
  }
}

export {};
