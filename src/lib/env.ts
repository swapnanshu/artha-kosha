import "server-only";
import { z } from "zod";

/**
 * Validated on first use, never at import time: `next build` must be able to
 * type-check and prerender without any real secrets present.
 */
const serverEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1).default("artha-kosha-dev"),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  OWNER_EMAIL: z.string().email().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  TOKEN_ENC_KEY: z.string().optional(),
  SMS_WEBHOOK_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  BACKUP_BUCKET: z.string().default("artha-kosha-backups"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (!cached) cached = serverEnvSchema.parse(process.env);
  return cached;
}

/** OWNER_EMAIL is the authoritative single-owner check; fail loudly without it. */
export function ownerEmail(): string {
  const { OWNER_EMAIL } = serverEnv();
  if (!OWNER_EMAIL) {
    throw new Error("OWNER_EMAIL is not set. The app cannot decide who the owner is.");
  }
  return OWNER_EMAIL;
}

export function usingEmulators(): boolean {
  return (
    process.env.NEXT_PUBLIC_USE_EMULATORS === "true" ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)
  );
}
