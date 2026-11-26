import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { serverEnv, usingEmulators } from "@/lib/env";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text) as ServiceAccount;
}

/**
 * One App per server instance. With no service account we initialize with just
 * a project id, which is exactly what the emulator needs.
 */
export function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const raw = serverEnv().FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const sa = parseServiceAccount(raw);
    return initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    });
  }

  if (!usingEmulators()) {
    console.warn(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set and emulators are off: Admin SDK calls will fail.",
    );
  }
  return initializeApp({ projectId: serverEnv().FIREBASE_PROJECT_ID });
}

export function adminDb() {
  const db = getFirestore(adminApp());
  // `settings()` throws once the client has been used. A module-level flag
  // does not survive HMR in dev, so the call is made best-effort: the first
  // call configures it, later ones are a harmless no-op.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Already configured on this Firestore instance.
  }
  return db;
}

export function adminAuth() {
  return getAuth(adminApp());
}
