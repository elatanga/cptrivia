import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let cachedDb;

export function getFirebaseAdminApp(env = process.env) {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

export function getFirebaseDb(env = process.env) {
  if (!cachedDb) {
    cachedDb = getFirestore(getFirebaseAdminApp(env));
  }
  return cachedDb;
}

export function resetFirebaseDbForTests() {
  cachedDb = undefined;
}
