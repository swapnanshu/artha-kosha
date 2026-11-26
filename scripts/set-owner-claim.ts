/**
 * Grants `owner: true` to the one Google account that may use this ledger.
 *
 *   bun run owner-claim
 *
 * Reads FIREBASE_PROJECT_ID / OWNER_EMAIL / FIREBASE_SERVICE_ACCOUNT_JSON from
 * .env.local (Bun loads it automatically). Falls back to Application Default
 * Credentials (`gcloud auth application-default login` or
 * GOOGLE_APPLICATION_CREDENTIALS) when no service-account JSON is set.
 *
 * The account must have signed in once already, because Google only creates the
 * Firebase Auth user record on first sign-in. Nothing in the app can
 * self-grant this claim, which is the point: even a correct password and a
 * verified email are not enough without it.
 */
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "artha-kosha-dev";
const email = process.env.OWNER_EMAIL ?? "";

if (email === "") {
  console.error("OWNER_EMAIL is required, e.g. OWNER_EMAIL=you@gmail.com bun run owner-claim");
  process.exit(1);
}

const useEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

const app = useEmulator
  ? initializeApp({ projectId })
  : initializeApp({ projectId, credential: raw ? serviceAccountCredential(raw) : applicationDefault() });

function serviceAccountCredential(value: string) {
  const sa = JSON.parse(
    value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8"),
  ) as ServiceAccount;
  return cert({
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    privateKey: sa.private_key,
  });
}

const auth = getAuth(app);

async function main() {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, owner: true });
  // Force a fresh ID token so the claim shows up in the very next sign-in.
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Granted owner:true to ${email} (uid ${user.uid}) in ${projectId}.`);
}

main().catch((error: { code?: string }) => {
  if (error.code === "auth/user-not-found") {
    console.error(
      `No Firebase Auth user for ${email} in ${projectId} yet.\n` +
        `Sign in once at http://127.0.0.1:3100/sign-in (it will refuse you), then re-run this script.`,
    );
    process.exitCode = 1;
    return;
  }
  console.error("Could not set the owner claim:", error);
  process.exitCode = 1;
});
