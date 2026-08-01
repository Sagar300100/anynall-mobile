// src/lib/api.ts — mobile port of the web app's services/api.ts (buyer surface).
// Talks to the same backend (Cloud Functions HTTP API) with the same auth
// headers and response mapping. Seller/admin endpoints are intentionally
// omitted until the seller hub goes mobile.
import { getIdToken } from "firebase/auth";
import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  updateProfile,
} from "firebase/auth";
import type { MultiFactorError, MultiFactorResolver } from "firebase/auth";
import { auth, getAppCheckHeader } from "./firebase";

// =====================================================
//                      TYPES
// =====================================================
export interface ShowData {
  id: number | string;
  name: string;
  date: string;
  time: string;
  category: string;
  subcategory: string;
  sellingFormat: string;
  brand: string;
  shippedFrom: string;
  sellerRating: number;
  tags: string[];
  isLive: boolean;
  thumbnail: string;
  seller: string;
  title?: string;
  thumbnail_url?: string;
  scheduled_time?: string | null;
  sellerId?: number;
  sellerObj?: { id: number; username: string } | null;
  ownerUid?: string | null;
  replayUrl?: string | null;
}

// =====================================================
//                      CONFIG
// =====================================================
const BASE = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

// Verification/reset emails deep-link back into the app via the web domain
// (the site handles the action code, the app scheme picks the user back up).
const CONTINUE_URL = "https://anynall.com/auth/action";
function buildContinueUrl() {
  return CONTINUE_URL;
}

// =====================================================
//                     HELPERS
// =====================================================
export function mapShowToUI(show: any): ShowData {
  const rawId = show?.id ?? show?.$id ?? show?.id;
  const d = show?.scheduled_time ? new Date(show.scheduled_time) : null;
  const sellerName =
    show?.seller?.username ??
    show?.sellerUsername ??
    (typeof show?.seller === "string" ? show.seller : "Anonymous");

  return {
    ...show,
    id: typeof rawId === "string" ? rawId : Number(rawId || 0),
    name: show?.title ?? show?.name ?? "Untitled Show",
    thumbnail: show?.thumbnail_url ?? show?.thumbnail ?? "",
    date: d ? d.toISOString().split("T")[0] : "TBD",
    time: d ? d.toTimeString().slice(0, 5) : "TBD",
    category: show?.category ?? "Uncategorized",
    subcategory: show?.subcategory ?? "",
    sellingFormat: show?.sellingFormat ?? "Auction",
    brand: show?.brand ?? "N/A",
    shippedFrom: show?.shippedFrom ?? "N/A",
    sellerRating: show?.sellerRating ?? 4.5,
    tags: Array.isArray(show?.tags) ? show.tags : [],
    isLive: !!(show?.isLive ?? show?.is_live),
    seller: sellerName,
    ownerUid: show?.ownerUid ?? null,
    replayUrl: show?.replay_url ?? show?.replayUrl ?? null,
  };
}

async function throwIfNotOk(res: Response, url: string) {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const t = await res.text();
      if (t) msg = `${res.status} ${t}`;
    } catch {}
    throw new Error(`HTTP ${msg} for ${url}`);
  }
  return res;
}

async function authHeaders(): Promise<Record<string, string>> {
  const u = auth.currentUser;
  if (!u) return {};
  try {
    const tok = await getIdToken(u, /*forceRefresh*/ false);
    return { Authorization: `Bearer ${tok}` };
  } catch {
    return {};
  }
}

export async function j<T = any>(
  path: string,
  init?: RequestInit,
  needsAuth = false
): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await getAppCheckHeader()),
      ...((init?.headers as Record<string, string>) || {}),
      ...(needsAuth ? await authHeaders() : {}),
    },
  });
  await throwIfNotOk(res, url);
  return (await res.json()) as T;
}

// =====================================================
//                   SESSION (RBAC)
// =====================================================
export async function sessionMe(): Promise<{
  isAuthenticated: boolean;
  uid?: string;
  email?: string;
  role?: string;
  claims?: Record<string, any>;
}> {
  return j("/api/auth/me", { method: "GET" }, true);
}

/** Records the current device after sign-in; flags sign-ins from new devices. */
export async function sessionCheck(): Promise<{
  newDevice: boolean;
  firstDevice?: boolean;
  deviceLabel?: string;
}> {
  return j("/api/auth/session-check", { method: "POST" }, true);
}

// NOTE: shows are read straight from Firestore (see lib/shows.ts) — the
// deployed HTTP API has no /api/shows route; that's a web-app pattern too.

// =====================================================
//                     ORDERS API
// =====================================================
export interface BuyerOrder {
  id: string;
  productTitle: string;
  amount: number;
  currency: string;
  status: string;
  showId?: string | null;
  shipment: {
    status: string | null;
    courierName: string | null;
    awbCode: string | null;
  } | null;
  createdAt: string | null;
}

/** The signed-in buyer's orders, newest first (GET /api/orders/mine). */
export async function listMyOrders(): Promise<BuyerOrder[]> {
  const data = await j<{ orders: BuyerOrder[] }>(
    "/api/orders/mine",
    { method: "GET" },
    true
  );
  return Array.isArray(data?.orders) ? data.orders : [];
}

// =====================================================
//                   AUTH (FIREBASE)
// =====================================================

/** Current user (or null) */
export async function me(): Promise<{ id: string; email: string } | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try {
    await u.reload();
  } catch {}
  return { id: u.uid, email: u.email || "" };
}

// Holds the resolver between a login() that hit a 2FA challenge and the
// follow-up resolveMfaLogin(). Module-scoped so the UI just submits a code.
let pendingMfaResolver: MultiFactorResolver | null = null;

/** Same friendly error mapping as the web app — users never see raw codes. */
export function friendlyAuthError(err: any): string {
  const code: string = err?.code || "";
  switch (code) {
    case "auth/network-request-failed":
      return "We couldn't reach our sign-in servers. Please check your internet connection and try again.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password. Please try again.";
    case "auth/user-not-found":
      return "No account found with that email address.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact hello@anynall.com if you believe this is a mistake.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a minute and try again, or reset your password.";
    case "auth/email-already-in-use":
      return "An account already exists with this email. Try signing in instead.";
    case "auth/weak-password":
      return "Please choose a stronger password (at least 8 characters).";
    case "auth/password-does-not-meet-requirements":
      return "Your password doesn't meet the requirements. Use at least 8 characters including an uppercase letter, a lowercase letter, a number, and a special character (e.g. ! @ # $).";
    case "auth/operation-not-allowed":
      return "Sign-in is temporarily unavailable. Please try again shortly.";
    default:
      if (typeof err?.message === "string" && err.message && !/^Firebase:/i.test(err.message)) {
        return err.message;
      }
      return `Something went wrong. Please try again in a moment.${code ? ` (${code.replace(/^auth\//, "")})` : ""}`;
  }
}

/** Bound how long an auth call can hang before surfacing the network message. */
function withAuthTimeout<T>(p: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const e: any = new Error("Sign-in timed out.");
      e.code = "auth/network-request-failed";
      reject(e);
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Email + password login. Throws { code:"MFA_REQUIRED" } if 2FA is required. */
export async function login(email: string, password: string) {
  let cred;
  try {
    cred = await withAuthTimeout(signInWithEmailAndPassword(auth, email, password));
  } catch (err: any) {
    if (err?.code === "auth/multi-factor-auth-required") {
      pendingMfaResolver = getMultiFactorResolver(auth, err as MultiFactorError);
      const mfaErr: any = new Error("Two-factor code required.");
      mfaErr.code = "MFA_REQUIRED";
      throw mfaErr;
    }
    const friendly: any = new Error(friendlyAuthError(err));
    friendly.code = err?.code || "auth/unknown";
    throw friendly;
  }
  const u = cred.user;

  if (!u.emailVerified) {
    try {
      await sendEmailVerification(u, { url: buildContinueUrl() });
    } catch {}
    throw new Error(
      "Please verify your email. A new verification link was sent to your inbox."
    );
  }

  // Best-effort login-anomaly check — fire-and-forget, never blocks sign-in.
  sessionCheck().catch(() => {});

  return { id: u.uid, email: u.email || "" };
}

/** Complete a 2FA sign-in with the 6-digit authenticator code. */
export async function resolveMfaLogin(code: string) {
  const resolver = pendingMfaResolver;
  if (!resolver) throw new Error("Your 2FA session expired. Please sign in again.");
  const totpHint =
    resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ||
    resolver.hints[0];
  if (!totpHint) throw new Error("No 2FA method found on this account.");
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, code.trim());
  const cred = await resolver.resolveSignIn(assertion);
  pendingMfaResolver = null;
  const u = cred.user;
  sessionCheck().catch(() => {});
  return { id: u.uid, email: u.email || "" };
}

/** Check whether a username is free (best-effort; real check is on claim). */
export async function checkUsername(
  username: string
): Promise<{ available: boolean; reason?: string }> {
  try {
    const res = await fetch(
      `${BASE}/api/profile/check-username?u=${encodeURIComponent(username)}`,
      { headers: { ...(await getAppCheckHeader()) } }
    );
    if (!res.ok) return { available: false, reason: "CHECK_FAILED" };
    return await res.json();
  } catch {
    return { available: false, reason: "CHECK_FAILED" };
  }
}

/** Create user, set displayName, claim username server-side, send verification email. */
export async function register(
  email: string,
  password: string,
  name?: string,
  username?: string
) {
  const cleanUsername = (username || "").toLowerCase().trim();

  if (cleanUsername) {
    const check = await checkUsername(cleanUsername);
    // Only block on a DEFINITIVE answer — CHECK_FAILED means the availability
    // API couldn't be reached, not that the name is taken. The atomic
    // server-side claim below is the real authority.
    if (!check.available && check.reason !== "CHECK_FAILED") {
      const why =
        check.reason === "RESERVED" ? "That username is reserved." :
        check.reason === "INVALID_FORMAT" ? "Invalid username format." :
        `Username @${cleanUsername} is already taken. Try another.`;
      throw new Error(why);
    }
  }

  let cred;
  try {
    cred = await withAuthTimeout(createUserWithEmailAndPassword(auth, email, password));
  } catch (err: any) {
    const friendly: any = new Error(friendlyAuthError(err));
    friendly.code = err?.code || "auth/unknown";
    throw friendly;
  }

  if (name && name.trim()) {
    // displayName is what Aadhaar verification compares against, so it must
    // be saved before any KYC flow runs.
    try { await updateProfile(cred.user, { displayName: name.trim() }); } catch {}
  }

  if (cleanUsername) {
    try {
      const token = await getIdToken(cred.user, /*forceRefresh*/ true);
      const r = await fetch(`${BASE}/api/profile/claim-username`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await getAppCheckHeader()),
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: cleanUsername }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (data?.error === "USERNAME_TAKEN") {
          throw new Error(
            `Username @${cleanUsername} was just taken. Pick another in Account Settings.`
          );
        }
        console.warn("[register] username claim failed:", data?.error);
      }
    } catch (err) {
      // Don't fail the whole signup over username — the Auth account exists.
      if (err instanceof Error && err.message.startsWith("Username @")) throw err;
      console.warn("[register] username claim threw:", err);
    }
  }

  try {
    await sendEmailVerification(cred.user, { url: buildContinueUrl() });
  } catch {}

  return {
    id: cred.user.uid,
    email: cred.user.email || "",
    name: name?.trim() || "",
    username: cleanUsername,
  };
}

/** Logout */
export async function logout() {
  await signOut(auth);
}

/** Send the password-reset email. */
export async function requestPasswordReset(email: string) {
  try {
    await sendPasswordResetEmail(auth, email, { url: buildContinueUrl() });
  } catch (err: any) {
    throw new Error(friendlyAuthError(err));
  }
}

/** Complete a password reset with the emailed action code. */
export async function resetPassword(oobCode: string, newPassword: string) {
  try {
    await confirmPasswordReset(auth, oobCode, newPassword);
  } catch (err: any) {
    throw new Error(friendlyAuthError(err));
  }
}

/** Apply an email-verification action code. */
export async function verifyEmail(oobCode: string) {
  await applyActionCode(auth, oobCode);
}
