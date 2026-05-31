import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  setPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

function buildFirebaseConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

let auth: Auth | undefined;
let db: Firestore | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (!getApps().length) {
    const firebaseConfig = buildFirebaseConfig();
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      throw new Error("Firebase: configure NEXT_PUBLIC_FIREBASE_* no .env");
    }
    return initializeApp(firebaseConfig);
  }
  return getApp();
}

export function getClientAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error("Firebase Auth só funciona no navegador");
  }
  if (!auth) {
    const app = getFirebaseApp();
    try {
      auth = initializeAuth(app, {
        persistence: browserLocalPersistence,
      });
    } catch {
      auth = getAuth(app);
      void setPersistence(auth, browserLocalPersistence);
    }
  }
  return auth;
}

export async function waitForAuthReady(): Promise<Auth> {
  const instance = getClientAuth();
  await instance.authStateReady();
  return instance;
}

export function getClientDb(): Firestore {
  if (typeof window === "undefined") {
    throw new Error("Firestore do cliente só funciona no navegador");
  }
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export {
  ensureClientTenant,
  getClientTenant,
  updateClientPlan,
  updateClientTenantProfile,
  completeClientOnboarding,
  acceptClientLgpd,
} from "./client-tenant.js";
export * from "./client-data.js";
export type { Plan, PlanStatus, Tenant, BotMenuItemConfig } from "./types.js";
