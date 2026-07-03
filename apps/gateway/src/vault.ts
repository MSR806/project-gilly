import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type Vault = {
  encrypt: (plain: string) => string;
  decrypt: (enc: string) => string;
};

/**
 * AES-256-GCM vault keyed by a hash of `key`. Encoding is `iv:authTag:ciphertext`, all base64.
 * Injectable so tests pass a fixed key; the entrypoint passes `GILLY_VAULT_KEY`.
 */
export function makeVault(key: string): Vault {
  const secret = createHash("sha256").update(key).digest();

  function encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
  }

  function decrypt(enc: string): string {
    const [ivB64, tagB64, dataB64] = enc.split(":");
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("malformed ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  return { encrypt, decrypt };
}
