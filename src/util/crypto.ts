import crypto, {randomBytes, timingSafeEqual} from "crypto";

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

function generateOIDCHash(input: string) {
  return crypto.createHash("sha256").update(input).digest().slice(0, 16).toString("base64url");
}

export {generateSecureString, secureCompare, generateOIDCHash};
