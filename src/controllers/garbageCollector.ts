import {prismaDb} from "../db/index.js";
import {moduleLogger} from "../logger.js";

const gcLogger = moduleLogger("GCController");

async function garbageCollect() {
  gcLogger.info("Running garbage collector");
  const time5minsago = Date.now() - 5 * 60 * 1000;
  await prismaDb.byondCert.deleteMany({
    where: {
      createdTime: {
        lt: new Date(time5minsago).toISOString(),
      },
    },
  });
}

let registered = false;
export function registerCollector() {
  if (registered) throw Error("Attempted to register garbage collector twice");
  registered = true;

  function asyncWrapper() {
    garbageCollect().catch(e => {
      gcLogger.crit("Error occured while running garbage collector", {e});
    });
  }
  //1 hour
  setInterval(asyncWrapper, 60 * 60 * 1000);
  setImmediate(asyncWrapper);
}

export {garbageCollect};
