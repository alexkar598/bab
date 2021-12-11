import Prisma from "@prisma/client";
import config from "config";
import {moduleLogger} from "../logger.js";

const dbLogger = moduleLogger("Database");

const prisma = new Prisma.PrismaClient({
  datasources: {
    db: {
      url: config.get<string>("database.connectionString"),
    },
  },
  log: [
    {
      emit: "event",
      level: "query",
    },
    {
      emit: "event",
      level: "error",
    },
    {
      emit: "event",
      level: "info",
    },
    {
      emit: "event",
      level: "warn",
    },
  ],
});

prisma.$on("query", _e => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const {timestamp, ...e} = _e;
  if (e.duration > 100) {
    dbLogger.warning("Slow query", e);
  }
  dbLogger.log(config.get<string>("logging.database.levels.query"), "Database Query", e);
});
function logger(level: string) {
  return function (e: {timestamp: Date; message: string; target: string}) {
    dbLogger.log(config.get<string>(`logging.database.levels.${level}`), e.message, {
      target: e.target,
    });
  };
}
prisma.$on("info", logger("info"));
prisma.$on("warn", logger("warn"));
prisma.$on("error", logger("error"));

async function connectDb() {
  return await prisma.$connect();
}

export {prisma as prismaDb, connectDb};

process.on("SIGTERM", () => {
  prisma.$disconnect();
});
