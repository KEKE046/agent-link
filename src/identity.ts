import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, hostname, homedir } from "node:os";

let cached: string | null = null;

export function getMachineId(): string {
  if (cached) return cached;
  const host = hostname();
  let seed: string;
  try {
    seed = readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    // Fallback for macOS or systems without /etc/machine-id
    seed = `${host}-${arch()}-${homedir()}`;
  }
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  cached = `${host}-${hash}`;
  return cached;
}
