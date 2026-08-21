// src/lib/push.ts — Expo push registration (Gap 1 of marketplace-gaps-spec.md).
//
// The device's Expo push token is posted to POST /api/profile/push-token
// { token, platform } and removed with DELETE /api/profile/push-token on
// sign-out. The backend for that route ships in a parallel wave, so every
// network step here tolerates a 404 as a silent no-op — the token is simply
// re-posted on a later sign-in once the route exists.
//
// FAILURE-TOLERANT BY CONTRACT: registerForPush()/unregisterPush() never
// throw. Push is a bonus channel; it must never be able to break sign-in,
// sign-out, or anything else that calls it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { j } from './api';
import { auth } from './firebase';

/** '0' = pushes turned off in Settings. Anything else (including absent) = on:
 *  the feature defaults on because iOS is asked PROVISIONALLY (silent grant,
 *  quiet delivery — no dialog) and Android shows its one runtime prompt. */
const PREF_KEY = 'anynall:push-enabled';
/** Last token successfully POSTed, as JSON { uid, token }. Keyed by uid so a
 *  different account signing in on this device re-posts the same token. */
const POSTED_KEY = 'anynall:push-posted';

export type PushRegisterResult =
  /** Token obtained; server POST done or queued for silent retry next sign-in. */
  | 'registered'
  /** The Settings toggle is off — nothing was asked, fetched, or sent. */
  | 'disabled'
  /** OS permission denied. */
  | 'denied'
  /** Web, simulator, signed out, or no EAS projectId — push can't exist here. */
  | 'unavailable'
  /** Transient failure (offline, Expo token service) — retried next sign-in. */
  | 'failed';

type PostedToken = { uid: string; token: string };

async function readPosted(): Promise<PostedToken | null> {
  try {
    const raw = await AsyncStorage.getItem(POSTED_KEY);
    return raw ? (JSON.parse(raw) as PostedToken) : null;
  } catch {
    return null;
  }
}

async function writePosted(p: PostedToken | null): Promise<void> {
  try {
    if (p) await AsyncStorage.setItem(POSTED_KEY, JSON.stringify(p));
    else await AsyncStorage.removeItem(POSTED_KEY);
  } catch {
    /* storage unavailable — worst case is one redundant POST later */
  }
}

/** The user's on/off choice from Settings. Default on (see PREF_KEY). */
export async function getPushPreference(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PREF_KEY)) !== '0';
  } catch {
    return true;
  }
}

export async function setPushPreference(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable — registerForPush treats absent as on */
  }
}

/** Granted, or iOS provisional (quiet delivery) — both mean we may notify. */
function isAllowed(s: Notifications.NotificationPermissionsStatus): boolean {
  return s.granted || s.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Does the OS currently let this app notify? (False on web/simulators.) */
export async function canNotify(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  try {
    return isAllowed(await Notifications.getPermissionsAsync());
  } catch {
    return false;
  }
}

/** Spec: Android channel "default", HIGH importance — created BEFORE the token
 *  fetch so the very first push already has a loud channel to land on. The
 *  backend's sender should pass channelId:'default' on Android messages
 *  (an Expo push without a channelId falls back to Expo's own channel). */
async function ensureDefaultChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notifications',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4DB8FF',
  });
}

/** EAS projectId, resolved robustly: expoConfig carries it in dev and EAS
 *  builds; easConfig covers manifests where expoConfig isn't populated. */
function resolveProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

// The underlying FCM/APNs device token can rotate while the app is installed;
// the Expo token derived from it changes with it. Re-run registration on
// rotation — the (uid, token) cache check keeps it a no-op when nothing
// actually changed, so the re-post is silent. One listener per JS session.
let rotationSub: ReturnType<typeof Notifications.addPushTokenListener> | null = null;
function watchTokenRotation() {
  if (rotationSub) return;
  rotationSub = Notifications.addPushTokenListener(() => {
    registerForPush().catch(() => {});
  });
}

/**
 * Register this device for push and post the token to the profile.
 *
 * Permission TIMING is the caller's: session.tsx invokes this on auth-ready,
 * so the iOS ask happens on first SIGN-IN — never on app launch — and it is
 * the PROVISIONAL ask (spec): iOS grants it silently with quiet delivery, no
 * dialog. Android 13+ shows its runtime prompt at the same moment.
 *
 * Never throws; the result is informational (Settings uses it for honest
 * toggle feedback, session.tsx ignores it).
 */
export async function registerForPush(): Promise<PushRegisterResult> {
  try {
    // Push is native-device-only: web has no Expo push pipeline here and
    // simulators have no APNs/FCM identity — a clean skip, not an error.
    if (Platform.OS === 'web' || !Device.isDevice) return 'unavailable';
    // The Settings toggle is authoritative: off means no prompt, no token
    // fetch, no network.
    if (!(await getPushPreference())) return 'disabled';
    // The token is stored on users/{uid} — without a user there is nothing
    // to attribute it to (and the POST is authGuarded anyway).
    const user = auth.currentUser;
    if (!user) return 'unavailable';

    let settings = await Notifications.getPermissionsAsync();
    if (!isAllowed(settings) && settings.canAskAgain) {
      settings = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true, allowProvisional: true },
      });
    }
    if (!isAllowed(settings)) return 'denied';

    try {
      await ensureDefaultChannel();
    } catch {
      /* channel creation failing must not block the token — FCM still delivers */
    }

    const projectId = resolveProjectId();
    if (!projectId) return 'unavailable';

    let token: string;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch {
      return 'failed'; // offline / Expo service hiccup — retried next auth-ready
    }
    if (!token) return 'failed';

    watchTokenRotation();

    // POST only when this (uid, token) pair isn't stored server-side yet — the
    // common path (same user, same device, unchanged token) costs no network.
    const cached = await readPosted();
    if (cached && cached.uid === user.uid && cached.token === token) return 'registered';

    try {
      await j(
        '/api/profile/push-token',
        { method: 'POST', body: JSON.stringify({ token, platform: Platform.OS }) },
        /* needsAuth */ true
      );
      await writePosted({ uid: user.uid, token });
    } catch {
      // Deliberately silent — most likely the 404 while the push backend wave
      // hasn't landed. The pair is NOT cached, so the next auth-ready
      // re-posts; the device itself is fully set up either way.
    }
    return 'registered';
  } catch {
    // Push must never break sign-in — whatever this was, swallow it.
    return 'failed';
  }
}

/**
 * Remove this device's push token. Must run while the user can still
 * authenticate — logout() in api.ts calls it BEFORE signOut, because the
 * DELETE is authGuarded and there is no ID token afterwards. session.tsx's
 * signed-out branch calls it too as a backstop (token revocation, account
 * disabled): there it only clears the local cache, which is exactly what
 * forces a fresh POST on the next sign-in. Never throws.
 */
export async function unregisterPush(): Promise<void> {
  try {
    const cached = await readPosted();
    // Local cache first: even if the DELETE can't be sent, the next sign-in
    // must re-POST rather than trust that the server still has this token.
    await writePosted(null);
    if (!auth.currentUser) return;
    // `token` tells the server WHICH device row to drop (a user can be signed
    // in on several devices). A backend that ignores the body and clears all
    // of the user's tokens is also acceptable — just blunter.
    await j(
      '/api/profile/push-token',
      { method: 'DELETE', body: cached ? JSON.stringify({ token: cached.token }) : undefined },
      /* needsAuth */ true
    );
  } catch {
    // Silent — including the 404 before the push backend wave lands.
  }
}
