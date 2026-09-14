import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

function getServiceAccountFromEnv(): any | null {
  const envVar = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!envVar) return null;

  try {
    if (envVar.trim().startsWith('{')) {
      return JSON.parse(envVar);
    }
    const json = Buffer.from(envVar, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY', err);
    return null;
  }
}

const serviceAccount = getServiceAccountFromEnv();

if (!getApps().length) {
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: firebaseConfig.projectId,
    });
  } else {
    // Fallback: This will require GOOGLE_APPLICATION_CREDENTIALS / default credentials
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
}

export const adminAuth = getAuth();

const databaseId = (firebaseConfig as any).firestoreDatabaseId as string | undefined;

// firebase-admin v* overload: getFirestore(databaseId: string)
export const adminDb = databaseId ? getFirestore(databaseId) : getFirestore();

