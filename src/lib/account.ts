// src/lib/account.ts — account security: the mobile port of the website's
// account-management surface (pages/AccountSettingsPage.tsx security/danger
// sections, components/TwoFactorSection.tsx, services/api.ts) against
// functions/accountRouter.js and functions/authRouter.js.
//
// PARITY NOTE — the website's Change Email / Change Password modals are
// UNWIRED shells (they alert() and close). This module implements the real
// flows through Firebase Auth instead, because the app's house rule is that
// nothing in the UI may pretend: verifyBeforeUpdateEmail for email changes,
// reauthenticate + updatePassword for password changes.
//
// RECENT-AUTH MODEL — /api/account/delete and /api/auth/revoke-sessions sit
// behind requireRecentAuth(): the caller's ID token must have been minted by
// an actual sign-in within the last 5 minutes. Password accounts satisfy it
// by re-authenticating (which refreshes auth_time); Google/Apple-only
// accounts have no password to re-enter, so their remedy is a fresh
// sign-out/sign-in — hasPasswordProvider() tells screens which path to show.
import {
  EmailAuthProvider,
  getIdToken,
  multiFactor,
  reauthenticateWithCredential,
  signOut,
  TotpMultiFactorGenerator,
  updatePassword,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import type { TotpSecret } from 'firebase/auth';

import { friendlyAuthError, j } from './api';
import { auth } from './firebase';

// Email links land on the site's action handler, same as the auth flows.
const CONTINUE_URL = 'https://anynall.com/auth/action';

// ── Providers & re-authentication ──────────────────────────────────────────

/** Does the signed-in account have an email+password credential? */
export function hasPasswordProvider(): boolean {
  const u = auth.currentUser;
  if (!u) return false;
  return u.providerData.some((p) => p.providerId === 'password');
}

/** Human name of the social provider, for "sign back in with Google" copy. */
export function socialProviderName(): string {
  const u = auth.currentUser;
  const ids = (u?.providerData ?? []).map((p) => p.providerId);
  if (ids.includes('google.com')) return 'Google';
  if (ids.includes('apple.com')) return 'Apple';
  return 'your sign-in provider';
}

/**
 * Prove identity with the current password. Refreshes the token's auth_time,
 * which is exactly what the server's recent-auth guard checks.
 */
export async function reauthWithPassword(password: string): Promise<void> {
  const u = auth.currentUser;
  if (!u || !u.email) throw new Error('You must be signed in.');
  try {
    const cred = EmailAuthProvider.credential(u.email, password);
    await reauthenticateWithCredential(u, cred);
  } catch (err: any) {
    throw friendlyReauthError(err);
  }
  // Force-refresh so the NEXT API call carries the fresh auth_time claim.
  await getIdToken(u, /* forceRefresh */ true);
}

function friendlyReauthError(err: any): Error {
  const code: string = err?.code || '';
  if (
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    code === 'auth/invalid-login-credentials'
  ) {
    return new Error('Incorrect password. Please try again.');
  }
  if (code === 'auth/too-many-requests') {
    return new Error('Too many attempts. Please wait a minute and try again.');
  }
  return new Error(friendlyAuthError(err));
}

/** True when a server error is the recent-auth 403 from requireRecentAuth. */
export function isRecentAuthError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('RECENT_AUTH_REQUIRED');
}

/** True when a Firebase error means "sign in again first". */
export function isStaleLoginError(err: unknown): boolean {
  return (err as any)?.code === 'auth/requires-recent-login';
}

// ── Change email ───────────────────────────────────────────────────────────

/**
 * Change the account email the SAFE way: after password re-auth, Firebase
 * emails a verification link to the NEW address, and the account only
 * switches once that link is opened. The old address keeps working until
 * then, so a typo can never lock the user out.
 */
export async function changeEmail(newEmail: string, currentPassword: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in.');
  await reauthWithPassword(currentPassword);
  try {
    await verifyBeforeUpdateEmail(u, newEmail.trim(), { url: CONTINUE_URL });
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use') {
      throw new Error('An account already exists with that email.');
    }
    if (err?.code === 'auth/invalid-email') {
      throw new Error('Please enter a valid email address.');
    }
    throw new Error(friendlyAuthError(err));
  }
}

// ── Change password ────────────────────────────────────────────────────────

/** Change password in-app: re-auth with the current one, then update. */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in.');
  await reauthWithPassword(currentPassword);
  try {
    await updatePassword(u, newPassword);
  } catch (err: any) {
    throw new Error(friendlyAuthError(err));
  }
}

// ── Two-factor authentication (TOTP) ───────────────────────────────────────
// Same Firebase MFA calls as the website's services/api.ts, so an enrolment
// made on either client challenges sign-ins on both.

/** Is an authenticator app currently enrolled? */
export function isTwoFactorEnrolled(): boolean {
  const u = auth.currentUser;
  if (!u) return false;
  return multiFactor(u).enrolledFactors.some(
    (f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID
  );
}

/** Enrolled factors (uid + label) so the UI can list and unenrol them. */
export function listEnrolledFactors(): { uid: string; label: string }[] {
  const u = auth.currentUser;
  if (!u) return [];
  return multiFactor(u).enrolledFactors.map((f) => ({
    uid: f.uid,
    label: f.displayName || 'Authenticator app',
  }));
}

// Holds the generated secret between start and verify — module-scoped, same
// pattern as the web client.
let pendingTotpSecret: TotpSecret | null = null;

/**
 * Begin TOTP enrolment. Returns the otpauth:// URL — which on a phone is
 * BETTER than a QR code: the authenticator app lives on this same device, so
 * the link opens it directly with the account pre-filled (you can't scan a QR
 * shown on the screen you're holding) — plus the manual-entry secret.
 * Throws auth/requires-recent-login when the session is stale.
 */
export async function startTotpEnrollment(): Promise<{ otpauthUrl: string; secretKey: string }> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in to enable 2FA.');
  const session = await multiFactor(u).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  pendingTotpSecret = secret;
  const otpauthUrl = secret.generateQrCodeUrl(u.email || 'Any & All', 'Any & All');
  return { otpauthUrl, secretKey: secret.secretKey };
}

/** Finish enrolment by verifying the first 6-digit code. */
export async function completeTotpEnrollment(
  code: string,
  label = 'Authenticator app'
): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in to enable 2FA.');
  if (!pendingTotpSecret) throw new Error('Start 2FA setup again — the code expired.');
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(pendingTotpSecret, code.trim());
  await multiFactor(u).enroll(assertion, label);
  pendingTotpSecret = null;
}

/** Drop the in-progress enrolment (user backed out of setup). */
export function cancelTotpEnrollment(): void {
  pendingTotpSecret = null;
}

/** Remove an enrolled factor. Throws auth/requires-recent-login when stale. */
export async function disableTwoFactor(factorUid: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in.');
  await multiFactor(u).unenroll(factorUid);
}

// ── Sessions ───────────────────────────────────────────────────────────────

/**
 * Revoke every refresh token on the account (POST /api/auth/revoke-sessions,
 * recent-auth-guarded). Other devices lose access as their ID tokens expire
 * (up to an hour); this device stays signed in until its own token expires.
 */
export async function revokeAllSessions(): Promise<void> {
  if (!auth.currentUser) throw new Error('You must be signed in.');
  await j('/api/auth/revoke-sessions', { method: 'POST' }, /* needsAuth */ true);
}

// ── Data export ────────────────────────────────────────────────────────────

/**
 * Everything the platform holds about the caller (GET /api/account/export —
 * DPDP right-to-access). Encrypted PAN/Aadhaar/bank numbers are excluded
 * server-side by design; masked forms are included.
 */
export async function exportMyData(): Promise<any> {
  return j('/api/account/export', { method: 'GET' }, /* needsAuth */ true);
}

// ── Delete account ─────────────────────────────────────────────────────────

/**
 * Full account erasure, mirroring the web flow exactly: fresh proof of
 * identity, force-refreshed token, then the server cascades the Firestore
 * erasure (shows, usernames, follows, DMs, KYC hashes, user doc) and deletes
 * the Auth record last. Signs out locally afterwards.
 *
 * `password` is required for password accounts; social-only accounts pass
 * null and rely on a recent sign-in (the server rejects stale ones with
 * RECENT_AUTH_REQUIRED — screens surface the sign-out/sign-in remedy).
 */
export async function deleteAccount(password: string | null): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('You must be signed in to delete your account.');
  if (password !== null) {
    await reauthWithPassword(password);
  } else {
    // Still refresh so the newest auth_time is on the token we send.
    await getIdToken(u, /* forceRefresh */ true);
  }
  await j('/api/account/delete', { method: 'POST' }, /* needsAuth */ true);
  // The Auth user is gone server-side; clear whatever local state remains.
  try {
    await signOut(auth);
  } catch {
    /* already invalid */
  }
}
