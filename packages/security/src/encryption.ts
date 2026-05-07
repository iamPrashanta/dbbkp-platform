import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 128-bit IV
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getMasterKey(): Buffer {
  const raw = process.env.MASTER_KEY;
  if (!raw) {
    throw new Error("[Security] MASTER_KEY environment variable is not set. Cannot encrypt/decrypt secrets.");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("[Security] MASTER_KEY must be a 64-character hex string (32 bytes).");
  }
  return buf;
}

export interface EncryptedPayload {
  encryptedValue: string; // base64
  iv: string;             // hex
  authTag: string;        // hex
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Uses a fresh random IV on every call.
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

/**
 * Decrypts a payload encrypted by `encrypt()`.
 * Throws if the data has been tampered with (auth tag mismatch).
 */
export function decrypt(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const encryptedBuffer = Buffer.from(payload.encryptedValue, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Generates a secure random 32-byte hex MASTER_KEY.
 * Use once during platform installation to generate the key.
 */
export function generateMasterKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
