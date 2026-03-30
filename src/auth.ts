// Authentication — token management + cookie signing for panel mode.

import { load, save } from "./store";

const COOKIE_NAME = "agent-link-auth";
const COOKIE_MAX_AGE = 30 * 24 * 3600; // 30 days

let adminToken: string | null = null;

export function initAuth(token?: string): string {
  const stored = load<{ token?: string }>("auth", {});
  if (token) {
    adminToken = token;
    if (stored.token !== token) save("auth", { token });
  } else if (stored.token) {
    adminToken = stored.token;
  } else {
    adminToken = crypto.randomUUID();
    save("auth", { token: adminToken });
  }
  return adminToken;
}

export function getToken(): string | null {
  return adminToken;
}

export function isEnabled(): boolean {
  return adminToken !== null;
}

export function resetAuth() {
  adminToken = null;
}

// --- Cookie signing ---

async function hmacSign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(adminToken!),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${value}.${hex.slice(0, 16)}`;
}

async function hmacVerify(signed: string): Promise<boolean> {
  const dot = signed.lastIndexOf(".");
  if (dot < 0) return false;
  const value = signed.slice(0, dot);
  const expected = await hmacSign(value);
  return expected === signed;
}

export function verifyToken(input: string): boolean {
  return adminToken !== null && input === adminToken;
}

export async function createSessionCookie(): Promise<string> {
  const ts = Date.now().toString(36);
  const signed = await hmacSign(ts);
  return `${COOKIE_NAME}=${encodeURIComponent(signed)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}

export async function verifyCookie(cookieHeader: string | null): Promise<boolean> {
  if (!cookieHeader || !adminToken) return false;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  return hmacVerify(decodeURIComponent(match[1]));
}
