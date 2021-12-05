import path from "path";
import {fileURLToPath} from "url";
import {connectDb} from "./db/index.js";
import {registerServer} from "./server.js";

export function dirname(metaUrl: string) {
  const __filename = fileURLToPath(metaUrl);
  return path.dirname(__filename);
}

async function main() {
  await registerServer();
  await connectDb();
}

main().catch(error => {
  console.error("An error occurred!", error);
});
