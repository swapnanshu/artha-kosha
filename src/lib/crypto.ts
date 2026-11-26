import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Gmail refresh tokens are long-lived bearer credentials for both inboxes.
 * They are stored encrypted at rest with AES-256-GCM, never in plain text and
 * never in the browser. The key lives only in the server env.
 */
export interface SealedSecret {
  enc: string;
  iv: string;
  tag: string;
}

function key(): Buffer {
  const raw = serverEnv().TOKEN_ENC_KEY;
  if (!raw || raw.length < 16) {
    throw new Error(
      "TOKEN_ENC_KEY is missing or too short. Generate one with: openssl rand -base64 32",
    );
  }
  // Accept a base64 32-byte key or any long passphrase: SHA-256 gives exactly
  // the 32 bytes GCM needs, deterministically.
  const decoded = Buffer.from(raw, "base64");
  return decoded.length === 32 ? decoded : createHash("sha256").update(raw).digest();
}

export function sealSecret(plain: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    enc: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(sealed: SealedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.enc, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Constant-time compare for webhook and cron secrets. */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** HMAC-free signed state for the OAuth round trip (keyed with TOKEN_ENC_KEY). */
export function signState(payload: string): string {
  const signature = createHash("sha256")
    .update(`${payload}.${key().toString("base64")}`)
    .digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

export function verifyState(state: string | null): string | null {
  if (!state) return null;
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = createHash("sha256")
    .update(`${payload}.${key().toString("base64")}`)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}
