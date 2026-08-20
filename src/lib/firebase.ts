// src/lib/firebase.ts — React Native counterpart of the web app's src/firebase.ts.
// Same Firebase project (bazaarlive-78422); auth sessions persist in
// AsyncStorage instead of browser localStorage.
import { getApp, getApps, initializeApp } from "firebase/app";
// @ts-expect-error — getReactNativePersistence exists only in the RN bundle
// of firebase/auth (undefined on web, where getAuth is used instead).
import { getAuth, getReactNativePersistence, initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * The ONLY Firebase-linked Storage bucket is
 * `bazaarlive-78422.firebasestorage.app`. The legacy `*.appspot.com` name does
 * not exist for this project and silently 404s every upload, so normalise it
 * here exactly like the web app does. Do not "correct" this to .appspot.com.
 */
const rawStorageBucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "";
const storageBucket = rawStorageBucket.replace(/\.appspot\.com$/, ".firebasestorage.app");

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY as string,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN as string,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID as string,
  storageBucket,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID as string,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Auth with durable sessions: users stay signed in across app restarts until
// they sign out or the refresh token is revoked server-side
// (POST /api/auth/revoke-sessions) — same policy as the web app.
//
// Defensive init: whether Metro serves the RN or the browser build of
// firebase/auth depends on exports-map resolution, and on the browser build
// getReactNativePersistence is undefined. A module-eval throw here kills the
// entire app at the splash screen, so every step degrades instead of throwing
// (worst case: in-memory sessions — sign-in works, persistence is lost).
function initNativeAuth() {
  try {
    if (typeof getReactNativePersistence === "function") {
      return initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
    console.warn("[firebase] getReactNativePersistence unavailable — using default persistence");
    return initializeAuth(app, {});
  } catch (err) {
    console.warn("[firebase] initializeAuth failed, falling back to getAuth:", (err as any)?.message);
    return getAuth(app);
  }
}

export const auth =
  Platform.OS === "web"
    ? getAuth(app) // web (Expo web preview): browser persistence built in
    : initNativeAuth();

export const db = getFirestore(app);
export const storage = getStorage(app);

/**
 * App Check: the web app attests via reCAPTCHA v3, which does not exist in
 * React Native, and the backend runs APP_CHECK_MODE=enforce — every API call
 * needs a valid token. Until the EAS dev build brings real device attestation
 * (Play Integrity / App Attest via @react-native-firebase/app-check), we use
 * Firebase's official debug-token exchange: a token whitelisted in Firebase
 * Console → App Check → Debug tokens is swapped for a short-lived real App
 * Check token over REST. No debug token configured → no header (API calls
 * will 401 with APP_CHECK_REQUIRED).
 */
const DEBUG_TOKEN = process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN || "";

let cachedToken: { token: string; expiresAt: number } | null = null;
/** Shared in-flight exchange: when the cached token expires, a screen mount
 *  firing 4 parallel API calls must cost ONE exchange round trip, not four. */
let inflightExchange: Promise<Record<string, string>> | null = null;
/** Negative cache: after a failed exchange, every request would otherwise pay
 *  a doomed exchange round trip before its guaranteed 401 — exactly when the
 *  App Check endpoint is unhealthy. Back off briefly instead. */
let failedUntil = 0;

export async function getAppCheckHeader(forceRefresh = false): Promise<Record<string, string>> {
  // NOTE(app-check): the debug-token exchange below is the interim path.
  // Real device attestation (Play Integrity / App Attest) plugs in ahead of it
  // once the native module ships in the EAS build — see
  // docs/app-check-rollout.md. Metro resolves require() statically, so the
  // native provider cannot be referenced before the package is installed.
  if (!DEBUG_TOKEN) return {};
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return { "X-Firebase-AppCheck": cachedToken.token };
  }
  // A token past the refresh buffer but not actually expired is still better
  // than no header — serve it on the backoff/failure paths below.
  const stillValid = (): Record<string, string> =>
    cachedToken && cachedToken.expiresAt > Date.now()
      ? { "X-Firebase-AppCheck": cachedToken.token }
      : {};
  if (!forceRefresh && now < failedUntil) return stillValid();
  if (inflightExchange) return inflightExchange;

  inflightExchange = (async (): Promise<Record<string, string>> => {
    // Hard timeout: every j() call awaits this shared promise, so a hung
    // exchange fetch (no response, no error) would freeze the ENTIRE API
    // surface of the app — abort instead and fall back.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(
        `https://firebaseappcheck.googleapis.com/v1/projects/${firebaseConfig.projectId}/apps/${firebaseConfig.appId}:exchangeDebugToken?key=${firebaseConfig.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ debug_token: DEBUG_TOKEN }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        console.warn("[appcheck] debug token exchange failed:", res.status);
        failedUntil = Date.now() + 30_000;
        return stillValid();
      }
      const data = await res.json();
      // ttl arrives like "3600s"
      const ttlMs = (parseInt(data.ttl, 10) || 1800) * 1000;
      cachedToken = { token: data.token, expiresAt: Date.now() + ttlMs };
      failedUntil = 0;
      return { "X-Firebase-AppCheck": data.token };
    } catch (err) {
      console.warn("[appcheck] token unavailable:", (err as any)?.message || err);
      failedUntil = Date.now() + 30_000;
      return stillValid();
    } finally {
      clearTimeout(timer);
      inflightExchange = null;
    }
  })();
  return inflightExchange;
}
