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
import { noteServerDate } from "./server-time";

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
  /** Null when the show doc carries no rating. There is no reviews pipeline
   *  yet, so most shows have none — this must never fall back to a plausible
   *  number, which a buyer would read as a real score. */
  sellerRating: number | null;
  tags: string[];
  isLive: boolean;
  thumbnail: string;
  /** Store handle, e.g. "musstorw". Empty when unknown — never "Anonymous". */
  seller: string;
  /** Store display name, e.g. "Musstorw". Empty when unknown. */
  sellerName?: string;
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
  // Empty, never "Anonymous" — these are real named stores, and the caller
  // resolves or falls back to a neutral label rather than mislabelling one.
  const sellerName =
    show?.sellerUsername ??
    show?.seller?.username ??
    (typeof show?.seller === "string" ? show.seller : "");

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
    sellerRating: typeof show?.sellerRating === "number" ? show.sellerRating : null,
    tags: Array.isArray(show?.tags) ? show.tags : [],
    isLive: !!(show?.isLive ?? show?.is_live),
    seller: sellerName,
    ownerUid: show?.ownerUid ?? null,
    replayUrl: show?.replay_url ?? show?.replayUrl ?? null,
  };
}

/** No request may hang forever: on a congested mobile link a half-open fetch
 *  left every flow built on j() — the bid gate, checkout, go-live — stuck in a
 *  busy state with no error. Long enough for a slow cold start, short enough
 *  that the user gets an actionable failure instead of a frozen button. */
const REQUEST_TIMEOUT_MS = 20_000;

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
  // App Check and the auth header are INDEPENDENT round trips. Awaiting them
  // inline in the object literal ran them one after the other, so every
  // request paid both latencies in series before the fetch even started.
  const t0 = Date.now();
  const [appCheck, authed] = await Promise.all([
    getAppCheckHeader(),
    needsAuth ? authHeaders() : Promise.resolve({} as Record<string, string>),
  ]);
  const tHeaders = Date.now();

  const doFetch = (appCheckHeaders: Record<string, string>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...appCheckHeaders,
        ...((init?.headers as Record<string, string>) || {}),
        ...authed,
      },
    }).finally(() => clearTimeout(timer));
  };

  let res = await doFetch(appCheck);
  // Free clock sync: every response carries a `Date` header, so the auction
  // countdown can run on the server's clock instead of the device's.
  noteServerDate(res.headers.get("date"), Date.now() - tHeaders);
  if (__DEV__) {
    console.warn(
      `[api] ${path} headers=${tHeaders - t0}ms fetch=${Date.now() - tHeaders}ms`
    );
  }

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {}
    // Self-heal on a stale/expired App Check token, mirroring the web client:
    // force a fresh token and retry ONCE. Without this a transient exchange
    // failure surfaced as a hard error on an otherwise healthy request.
    if (
      res.status === 401 &&
      /APP_CHECK_(REQUIRED|INVALID)/.test(bodyText)
    ) {
      const fresh = await getAppCheckHeader(/*forceRefresh*/ true);
      if (fresh["X-Firebase-AppCheck"]) {
        res = await doFetch(fresh);
        if (res.ok) return (await res.json()) as T;
        try {
          bodyText = await res.text();
        } catch {}
      }
    }
    throw new Error(`HTTP ${res.status}${bodyText ? ` ${bodyText}` : ""} for ${url}`);
  }
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

/** Adopt a 2FA challenge raised outside login() (e.g. Google/Apple sign-in on
 *  an MFA-enrolled account) so resolveMfaLogin() can complete it. */
export function adoptMfaChallenge(err: MultiFactorError) {
  pendingMfaResolver = getMultiFactorResolver(auth, err);
}

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

/** Check whether a username is free (best-effort; real check is on claim).
 *  Through j() so it gets the request timeout and App Check self-heal. */
export async function checkUsername(
  username: string
): Promise<{ available: boolean; reason?: string }> {
  try {
    return await j<{ available: boolean; reason?: string }>(
      `/api/profile/check-username?u=${encodeURIComponent(username)}`
    );
  } catch {
    return { available: false, reason: "CHECK_FAILED" };
  }
}

/** Atomically claim a username for the signed-in user (server is authority).
 *  Used by the post-social-signup completion step. Throws friendly errors.
 *  Through j() (timeout + App Check self-heal); the server's error code
 *  arrives inside the thrown message's body text. */
export async function claimUsername(username: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) throw new Error('Sign in first.');
  const clean = username.toLowerCase().trim();
  try {
    await j('/api/profile/claim-username', {
      method: 'POST',
      body: JSON.stringify({ username: clean }),
    }, true);
  } catch (e: unknown) {
    const text = e instanceof Error ? e.message : String(e);
    if (text.includes('USERNAME_TAKEN'))
      throw new Error(`@${clean} was just taken. Try another.`);
    if (text.includes('INVALID_FORMAT'))
      throw new Error('That username format isn’t allowed.');
    if (text.includes('RESERVED')) throw new Error('That username is reserved.');
    throw new Error('Could not claim the username. Please try again.');
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

// =====================================================
//                     REFERRAL
// =====================================================

/** The signed-in user's referral code + share link (GET /api/profile/referral).
 *  The server lazily creates the code on first read, so this never 404s.
 *  `link` is built server-side from REFERRAL_BASE — prefer it over deriving
 *  the URL client-side. There is no invite-tracking backend yet, so any
 *  counters shown must be genuine zeros, never invented numbers. */
export async function getMyReferral(): Promise<{ code: string; link: string }> {
  return j("/api/profile/referral", { method: "GET" }, /*needsAuth*/ true);
}

// =====================================================
//                 POLICY ACCEPTANCE
// =====================================================

/** Record Terms + Privacy + Refund acceptance (+ the 18+ confirmation) for
 *  the signed-in user (POST /api/profile/policy-acceptance). Written
 *  server-side — users/{uid} stays client-write-locked, so acceptance can
 *  only ever be stamped on the caller's own document. */
export async function acceptPolicies(): Promise<void> {
  await j("/api/profile/policy-acceptance", { method: "POST", body: JSON.stringify({}) }, true);
}

// =====================================================
//                 PROFILE (display fields)
// =====================================================

export interface MyProfile {
  username: string;
  handle: string;
  bio: string;
  avatar: string;
  referralCode: string;
}

/** The caller's display profile (GET /api/profile — lazily seeded). */
export async function getMyProfile(): Promise<MyProfile> {
  return j("/api/profile", { method: "GET" }, true);
}

/** Update display name + bio (PUT /api/profile). The username handle is
 *  deliberately immutable here — renaming requires the atomic
 *  /claim-username reservation. Server truncates: handle 60, bio 280. */
export async function updateMyProfile(p: { handle: string; bio?: string }): Promise<MyProfile> {
  return j("/api/profile", { method: "PUT", body: JSON.stringify(p) }, true);
}
