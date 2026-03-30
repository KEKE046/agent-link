// Node-level encryption — HKDF key derivation + AES-256-GCM message encryption.
// All operations are synchronous (node:crypto) to avoid changing send() signatures.

import { hkdfSync, createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Compute HMAC-SHA256(secret, machineId) for register authentication.
 * Proves the sender knows the shared secret without revealing it.
 */
export function computeAuth(secret: string, machineId: string): string {
  return createHmac("sha256", secret).update(machineId).digest("hex");
}

/**
 * Derive a per-node 256-bit encryption key from a shared secret and machineId.
 *   nodeKey = HKDF-SHA256(ikm=secret, salt=machineId, info="agent-link-node")
 */
export function deriveNodeKey(secret: string, machineId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, machineId, "agent-link-node", 32));
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns base64( iv[12] || authTag[16] || ciphertext ).
 */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 * Throws on authentication failure (wrong key / tampered data).
 */
export function decrypt(key: Buffer, ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < 28) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, "utf8") + decipher.final("utf8");
}
