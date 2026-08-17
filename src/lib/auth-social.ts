// src/lib/auth-social.ts — Google / Apple sign-in on top of the existing
// Firebase Auth setup (firebase.ts). Native SDKs produce an ID token, which is
// exchanged for a Firebase credential via signInWithCredential — the same
// session pipeline as email login (SessionProvider sees the user and the
// root guard swaps stacks; no navigation code needed here).
//
// Configuration is env-driven and honest: with no EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
// the Google button renders disabled with a setup notice instead of failing
// silently. Apple renders only where it can actually work (iOS device).
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  updateProfile,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { adoptMfaChallenge, sessionCheck } from './api';
import { auth } from './firebase';

/** Convert Firebase's MFA interrupt into the same MFA_REQUIRED signal the
 *  email login() throws, so the sign-in screen reuses one 2FA code step. */
function throwIfMfaRequired(err: any): void {
  if (err?.code === 'auth/multi-factor-auth-required') {
    adoptMfaChallenge(err);
    const mfaErr: any = new Error('Two-factor code required.');
    mfaErr.code = 'MFA_REQUIRED';
    throw mfaErr;
  }
}

// Firebase Console → Authentication → Sign-in method → Google → Web client ID.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';

/** False until EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is supplied — UI shows a
 *  disabled button with a setup hint rather than a broken flow. */
export const isGoogleConfigured = !!GOOGLE_WEB_CLIENT_ID && Platform.OS !== 'web';

/** Map provider/Firebase errors to human copy; never leak raw codes. */
export function friendlySocialError(err: any): string {
  const code: string = err?.code || '';
  switch (code) {
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Sign in with your email and password instead.';
    case 'auth/invalid-credential':
      return 'Sign-in could not be verified. Please try again.';
    case 'auth/network-request-failed':
      return "We couldn't reach our sign-in servers. Check your connection and try again.";
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact hello@anynall.com if you believe this is a mistake.';
    default:
      if (typeof err?.message === 'string' && err.message && !/^Firebase:/i.test(err.message)) {
        return err.message;
      }
      return 'Sign-in failed. Please try again in a moment.';
  }
}

let googleConfigured = false;

/**
 * Google sign-in via the native account sheet.
 * Resolves null when the user cancels; throws (friendly message) on failure.
 */
export async function signInWithGoogle(): Promise<{ id: string; email: string } | null> {
  if (!isGoogleConfigured) {
    throw new Error(
      'Google sign-in is not configured yet (missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).'
    );
  }
  // Lazy require: keeps the web preview bundle (no native module) working.
  const {
    GoogleSignin,
    statusCodes,
  } = require('@react-native-google-signin/google-signin');

  if (!googleConfigured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    googleConfigured = true;
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Drop the SDK's cached account so the chooser shows on every sign-in —
    // phones get shared, and silently reusing the last account is a trap.
    try {
      await GoogleSignin.signOut();
    } catch {}
    const res = await GoogleSignin.signIn();
    // v13+ returns { type: 'success' | 'cancelled', data }
    if (res?.type === 'cancelled') return null;
    const idToken: string | undefined = res?.data?.idToken ?? res?.idToken;
    if (!idToken) throw new Error('Google did not return a sign-in token. Please try again.');

    const credential = GoogleAuthProvider.credential(idToken);
    const cred = await signInWithCredential(auth, credential);
    sessionCheck().catch(() => {}); // same fire-and-forget device check as email login
    return { id: cred.user.uid, email: cred.user.email || '' };
  } catch (err: any) {
    if (
      err?.code === statusCodes?.SIGN_IN_CANCELLED ||
      err?.code === statusCodes?.IN_PROGRESS
    ) {
      return null;
    }
    if (err?.code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services is unavailable on this device.');
    }
    throwIfMfaRequired(err);
    if (__DEV__) console.warn('[auth-social] google failed:', err?.code, err?.message);
    throw new Error(friendlySocialError(err));
  }
}

/** Apple sign-in is only offered where it genuinely works: real iOS. */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const AppleAuthentication = require('expo-apple-authentication');
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Apple sign-in (iOS only) with the Firebase-required SHA-256 nonce exchange.
 * Resolves null when the user cancels; throws (friendly message) on failure.
 */
export async function signInWithApple(): Promise<{ id: string; email: string } | null> {
  const AppleAuthentication = require('expo-apple-authentication');
  const Crypto = require('expo-crypto');

  const rawNonce: string = Crypto.randomUUID();
  const hashedNonce: string = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  let appleCredential: any;
  try {
    appleCredential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (err: any) {
    if (err?.code === 'ERR_REQUEST_CANCELED') return null;
    if (__DEV__) console.warn('[auth-social] apple request failed:', err?.code);
    throw new Error('Apple sign-in could not start. Please try again.');
  }

  if (!appleCredential?.identityToken) {
    throw new Error('Apple did not return a sign-in token. Please try again.');
  }

  try {
    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });
    const cred = await signInWithCredential(auth, credential);

    // Apple shares the name ONLY on the very first authorization — persist it.
    const givenName = appleCredential.fullName?.givenName;
    if (givenName && !cred.user.displayName) {
      const fullName = [givenName, appleCredential.fullName?.familyName]
        .filter(Boolean)
        .join(' ');
      try {
        await updateProfile(cred.user, { displayName: fullName });
      } catch {}
    }

    sessionCheck().catch(() => {});
    return { id: cred.user.uid, email: cred.user.email || '' };
  } catch (err: any) {
    throwIfMfaRequired(err);
    if (__DEV__) console.warn('[auth-social] apple exchange failed:', err?.code);
    throw new Error(friendlySocialError(err));
  }
}
