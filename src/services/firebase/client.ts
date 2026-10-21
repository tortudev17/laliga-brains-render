import { initializeApp, getApps } from "firebase/app";
import { connectAuthEmulator, getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import type { FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyA_VPCvZah7MJJA1hmzBeAwnSDvZ1nbY5Y",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "laliga-brains.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "laliga-brains",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "laliga-brains.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "425604558510",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:425604558510:web:b67134473f48d91ed9c73f",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-LER9LWZKEW",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? "https://laliga-brains-default-rtdb.europe-west1.firebasedatabase.app",
};

export const app = getApps().find((existingApp) => existingApp.name === "[DEFAULT]")
  ?? initializeApp(firebaseConfig);
export const auth = getAuth(app);

const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
const validDatabaseUrl = useEmulators
  ? /^http:\/\/127\.0\.0\.1:9000(?:\/|\?|$)/.test(firebaseConfig.databaseURL ?? "")
  : /^https:\/\/laliga-brains-default-rtdb\.europe-west1\.firebasedatabase\.app\/?$/.test(firebaseConfig.databaseURL ?? "");
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && validDatabaseUrl);
export const database: Database | null = validDatabaseUrl ? getDatabase(app, firebaseConfig.databaseURL) : null;
let storagePromise: Promise<FirebaseStorage> | undefined;
export function getFirebaseStorage() {
  storagePromise ??= import("firebase/storage").then(({ getStorage, connectStorageEmulator }) => {
    const instance = getStorage(app);
    if (useEmulators) connectStorageEmulator(instance, "127.0.0.1", 9199);
    return instance;
  });
  return storagePromise;
}

if (useEmulators) {
  connectAuthEmulator(auth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://127.0.0.1:9099", { disableWarnings: true });
  if (database) connectDatabaseEmulator(database, "127.0.0.1", 9000);
}

void setPersistence(auth, browserLocalPersistence).catch((error: unknown) => {
  console.warn("No se pudo guardar la sesión en este navegador.", error);
});
export async function initializeAnalytics() {
  if (typeof window !== "undefined") {
    const analytics = await import("firebase/analytics");
    if (await analytics.isSupported()) return analytics.getAnalytics(app);
  }
  return null;
}
