import {randomBytes, timingSafeEqual} from "crypto";

function generateSecureString(length: number): Promise<string> {
  return new Promise(resolve => {
    randomBytes(length, function (err, buffer) {
      resolve(buffer.toString("hex"));
    });
  });
}

function secureCompare(_a: string, _b: string) {
  const a = Buffer.from(_a);
  const b = Buffer.from(_b);

  return timingSafeEqual(a, b);
}

export {generateSecureString, secureCompare};
