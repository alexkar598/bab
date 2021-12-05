import {inspect} from "util";
import rTracer from "cls-rtracer";
import config from "config";
import winston, {Logger} from "winston";
const {createLogger, format, transports} = winston;
import chalk from "chalk";
import {table} from "table";
import pchars from "printable-characters";

const now = new Date();

export const logLevels = {
  emerg: 0,
  crit: 1,
  error: 2,
  warning: 3,
  info: 4,
  verbose: 5,
  debug: 6,
  off: 7,
};

const generatePastelColor = (input_str: string) => {
  const baseRed = 130;
  const baseGreen = 130;
  const baseBlue = 100;

  let seed = input_str.split("").reduce((acc, b) => acc ^ b.charCodeAt(0), 0);
  const rand_1 = Math.abs(Math.sin(seed++) * 10000) % 256;
  const rand_2 = Math.abs(Math.sin(seed++) * 10000) % 256;
  const rand_3 = Math.abs(Math.sin(seed++) * 10000) % 256;

  //build colour
  const red = Math.round((rand_1 + baseRed) / 2);
  const green = Math.round((rand_2 + baseGreen) / 2);
  const blue = Math.round((rand_3 + baseBlue) / 2);

  return `#${red.toString(16)}${green.toString(16)}${blue.toString(16)}`;
};

const colorMap: Map<string, string> = new Map();
const getColorFromString = (input_str: string) => {
  const color = colorMap.get(input_str) ?? generatePastelColor(input_str);
  colorMap.set(input_str, color);
  return color;
};

// eslint-disable-next-line prefer-const
let loggerLogger: Logger;

const consoleFormatter = format.printf(info => {
  const {timestamp, level, module, message, requestId, ...metadata} = info;
  const formattedMetadata = Object.entries(metadata).map(([key, val]) => [
    key,
    config.get<boolean>("logging.console.pretty")
      ? inspect(val, {colors: true, compact: true, breakLength: Infinity, depth: 5})
      : JSON.stringify(val),
  ]);
  const datatable = !formattedMetadata.length
    ? ""
    : table(formattedMetadata, {
        columnDefault: {
          wrapWord: true,
        },
        columns: [
          {
            verticalAlignment: "middle",
          },
          {
            width: 150,
          },
        ],
      });

  const color = getColorFromString(module);
  if (module === undefined) {
    loggerLogger.error(
      "Log was created without a module.",
      new Error("Log was created without a module."),
    );
  }

  const timestampfmt = chalk.inverse(`[${timestamp}]`);
  // noinspection HtmlUnknownTag
  const ridfmt =
    requestId !== undefined
      ? `<${chalk.hex(getColorFromString(requestId))(requestId)}>`
      : " ".repeat(38);
  const modulefmt = module !== undefined ? chalk.hex(color)(module) : chalk.red("NO_MODULE");
  return `${timestampfmt} ${level} ${ridfmt} (${modulefmt}) ${message}${
    formattedMetadata.length ? "\n" : ""
  }${datatable.substring(0, datatable.length - 1)}`;
});
const stripEmptyMeta = format(info => {
  Object.entries(info).forEach(([key, value]) => {
    if (value === undefined) {
      return delete info[key];
    }
    if (value === null) {
      return delete info[key];
    }
    if (typeof value === "object" && Object.keys(value).length === 0) {
      return delete info[key];
    }
  });
  return info;
});

const addRequestId = format(info => {
  info.requestId = rTracer.id();
  return info;
});

const maxLevelLen = Object.keys(logLevels).reduce((a, b) => Math.max(a, b.length), 0);
const padLevels = format(info => {
  info.level = info.level.concat(" ".repeat(maxLevelLen - pchars.strlen(info.level)));
  return info;
});

const logger = createLogger({
  level: "info",
  levels: logLevels,
  transports: [
    new transports.File({
      level: config.get<string>("logging.file.level"),
      silent: !config.get<boolean>("logging.file.enabled"),
      filename: `logs/${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}.log`,
      format: format.combine(
        stripEmptyMeta(),
        addRequestId(),
        format.timestamp({alias: "timestamp"}),
        format.errors({stack: true}),
        format.json(),
      ),
    }),
    new transports.File({
      level: config.get<string>("logging.file-err.level"),
      silent: !config.get<boolean>("logging.file-err.enabled"),
      filename: `logs/${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-err.log`,
      format: format.combine(
        stripEmptyMeta(),
        addRequestId(),
        format.timestamp({alias: "timestamp"}),
        format.errors({stack: true}),
        format.json(),
      ),
    }),
    new transports.Console({
      level: config.get<string>("logging.console.level"),
      silent: !config.get<boolean>("logging.console.enabled"),
      format: format.combine(
        stripEmptyMeta(),
        addRequestId(),
        format.timestamp({alias: "timestamp"}),
        format.errors({stack: true}),
        format.colorize({level: true}),

        padLevels(),

        consoleFormatter,
      ),
    }),
  ],
});

const loggers: Map<string, Logger> = new Map();

function moduleLogger(moduleName: string) {
  const subLogger = loggers.get(moduleName) || logger.child({module: moduleName});
  loggers.set(moduleName, subLogger);
  return subLogger;
}

loggerLogger = moduleLogger("Logger");

winston.addColors({
  emerg: "bold underline black redBG",
  crit: "bold underline red",
  error: "bold red",
  warning: "bold yellow",
  info: "white",
  verbose: "cyan",
  debug: "italic cyan",
});

export {moduleLogger};
