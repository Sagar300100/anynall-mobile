// src/lib/seller.ts — mobile port of the web seller-onboarding API client
// (services/api.ts:1141-1390) against functions/profileRouter.js, gstRouter,
// panRouter, bankRouter and digilockerRouter. Field names and enum values
// MUST match the server exactly — do not rename anything here.
//
// All endpoints require auth + App Check + verified email (the session layer
// already treats unverified accounts as signed out, so the 403
// EMAIL_NOT_VERIFIED path shouldn't occur in practice).
import { j } from './api';

// ── GST State/UT codes (ported from web constants/inStates.ts) ─────────────
export const IN_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

// ── Types (mirror GET /api/profile/seller-onboarding) ──────────────────────
export type TaxStatus = 'regular_gst' | 'composition' | 'unregistered_enrolled';
export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'action_required';

/** `mismatch` = the GSTIN is real and active, but its registration type isn't
 *  the one chosen at Tax Details. The seller resolves it by changing that
 *  selection; it is neither a rejection nor a review queue. */
export type GstVerificationStatus =
  | 'not_required'
  | 'pending'
  | 'verified'
  | 'manual_review'
  | 'mismatch'
  | 'rejected'
  | null;

export interface SellerOnboardingState {
  storeSetupComplete: boolean;
  aadhaarVerified: boolean;
  /** Absent on older deployments — the UI omits the row rather than guessing. */
  aadhaarVerifiedAt?: string | null;
  aadhaarVerifiedVia?: string | null;
  panVerified: boolean;
  /** Masked (e.g. ABCDE••••F) — the full PAN never reaches the client. */
  panMasked?: string | null;
  panVerifiedAt?: string | null;
  bankVerified: boolean;
  /** Absent until the extended backend is deployed. The full account number
   *  is KMS-encrypted server-side and never reaches the client. */
  bankVerificationStatus?:
    | 'verified'
    | 'rejected'
    | 'name_mismatch'
    | 'manual_review'
    | 'provider_unavailable'
    | null;
  bankNameMatchStatus?: string | null;
  bankFailureCode?: string | null;
  bankMasked?: string | null;
  bankIfsc?: string | null;
  bankVerifiedAt?: string | null;
  completedAt: string | null;
  storeName: string;
  storeHandle: string;
  /** Absent until the extended backend is deployed. */
  storePhotoUrl?: string | null;
  taxStatus: TaxStatus | null;
  gstVerificationStatus: GstVerificationStatus;
  gstMasked: string | null;
  gstLegalName: string | null;
  gstTaxpayerType: string | null;
  /** Verified business-register detail. Absent until the extended backend is
   *  deployed, so every consumer must tolerate undefined. */
  gstTradeName?: string | null;
  gstRegistrationStatus?: string | null;
  gstPrincipalPlace?: string | null;
  gstEffectiveDate?: string | null;
  gstStateCode?: string | null;
  gstReviewReason?: string | null;
  gstVerifiedAt?: string | null;
  enrolmentSubmitted: boolean;
  enrolmentVerificationStatus: 'pending' | 'verified' | 'rejected' | null;
  /** Draft restore for the unregistered path. The number is masked. */
  enrolmentMasked?: string | null;
  enrolmentStateCode?: string | null;
  enrolmentTurnoverBand?: TurnoverBand | null;
  enrolmentAddress?: string | null;
  enrolmentSubmittedAt?: string | null;
  declarationVersion?: string | null;
  declarationAcceptedAt?: string | null;
  sellerStateCode: string | null;
  interstateSalesAllowed: boolean;
  sellerTermsAccepted: boolean;
  /** Version the seller must accept now vs. what they last accepted. When they
   *  differ the old consent is stale and must not be carried forward. */
  sellerTermsVersion?: string | null;
  sellerTermsAcceptedVersion?: string | null;
  sellerTermsAcceptedAt?: string | null;
  taxDeclarationFor?: TaxStatus | null;
  applicationStatus: ApplicationStatus;
  /** Set at submission. Absent until the extended backend is deployed. */
  vacationMode?: boolean;
  sellerApplicationId?: string | null;
  submittedAt?: string | null;
}

/** Same rule the web app uses (App.tsx:449-459) to route hub vs onboarding. */
export function isOnboardingDone(s: SellerOnboardingState): boolean {
  const taxPathDone =
    s.taxStatus === 'unregistered_enrolled'
      ? !!s.enrolmentSubmitted
      : !!s.taxStatus && ['verified', 'manual_review'].includes(s.gstVerificationStatus || '');
  return !!s.completedAt && taxPathDone;
}

export type StepKey =
  | 'store'
  | 'tax'
  | 'aadhaar'
  | 'pan'
  | 'gst'
  | 'bank'
  | 'agreement'
  | 'review'
  | 'welcome';

/**
 * The real onboarding steps the seller works through, in order. Single source
 * of truth for every progress indicator — 'welcome' is the outcome screen,
 * not a step, so it isn't counted here.
 */
export const ONBOARDING_STEPS: { key: StepKey; label: string }[] = [
  { key: 'store', label: 'Store' },
  { key: 'tax', label: 'Tax' },
  { key: 'aadhaar', label: 'Identity' },
  { key: 'pan', label: 'PAN' },
  { key: 'gst', label: 'GST' },
  { key: 'bank', label: 'Bank' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'review', label: 'Review' },
];

/** Mirror of BecomeSellerPage.tsx firstIncompleteStep(). */
export function firstIncompleteStep(s: SellerOnboardingState): StepKey {
  if (['pending_review', 'action_required'].includes(s.applicationStatus)) return 'welcome';
  if (!s.storeSetupComplete) return 'store';
  if (!s.taxStatus) return 'tax';
  if (!s.aadhaarVerified) return 'aadhaar';
  if (!s.panVerified) return 'pan';
  const taxPathDone =
    s.taxStatus === 'unregistered_enrolled'
      ? s.enrolmentSubmitted
      : ['verified', 'manual_review'].includes(s.gstVerificationStatus || '');
  if (!taxPathDone) return 'gst';
  if (!s.bankVerified) return 'bank';
  if (!s.sellerTermsAccepted) return 'agreement';
  return 'review';
}

/** Extract the server's error code (e.g. HANDLE_TAKEN) from a thrown j() error. */
export function sellerErrorCode(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/"error"\s*:\s*"([A-Z_]+)"/);
  return m ? m[1] : null;
}

// ── Endpoints ──────────────────────────────────────────────────────────────
export function getSellerOnboarding() {
  return j<SellerOnboardingState>('/api/profile/seller-onboarding', { method: 'GET' }, true);
}

function postStore(body: Record<string, string>) {
  return j<{ ok: boolean; storeHandle: string }>(
    '/api/profile/seller-onboarding/store',
    { method: 'POST', body: JSON.stringify(body) },
    true
  );
}

/** URL-safe handle candidates derived from a store name (never shown to the
 *  user — the display name itself is never altered). */
function handleCandidates(storeName: string): string[] {
  let base = canonicalStoreName(storeName)
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 18);
  if (!/^[a-z]/.test(base)) base = `s${base}`.slice(0, 18);
  while (base.length < 3) base += 's';
  return [base, `${base}2`, `${base}3`, `${base}4`, `${base}${Math.floor(Math.random() * 900) + 100}`].map(
    (h) => h.slice(0, 20)
  );
}

/**
 * Saves step 1. The extended backend derives the handle itself, so no handle
 * is sent; the currently deployed build still requires one, so an
 * INVALID_HANDLE response triggers a retry with derived candidates (and
 * HANDLE_TAKEN walks to the next candidate). NAME_TAKEN is never retried —
 * the seller's chosen name is never silently altered.
 */
export async function saveStoreSetup(
  storeName: string,
  storeHandle?: string,
  storePhotoUrl?: string
): Promise<{ ok: boolean; storeHandle: string }> {
  const base: Record<string, string> = { storeName };
  if (storePhotoUrl) base.storePhotoUrl = storePhotoUrl;

  if (storeHandle) return postStore({ ...base, storeHandle });

  try {
    return await postStore(base);
  } catch (e) {
    if (sellerErrorCode(e) !== 'INVALID_HANDLE') throw e;
  }

  let lastError: unknown = null;
  for (const candidate of handleCandidates(storeName)) {
    try {
      return await postStore({ ...base, storeHandle: candidate });
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code !== 'HANDLE_TAKEN' && code !== 'RESERVED') throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error('STORE_SETUP_FAILED');
}

/**
 * Mirror of the server's canonicalisation — used ONLY to detect stale
 * availability results client-side, never as the source of truth.
 */
export function canonicalStoreName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Client-side pre-validation matching the server rules (3-30, charset). */
export function validateStoreNameLocal(raw: string): string | null {
  const canonical = canonicalStoreName(raw);
  if (canonical.length === 0) return null;
  if (canonical.length < 3) return 'Store name must be at least 3 characters.';
  if (canonical.length > 30) return 'Store name must be at most 30 characters.';
  if (!/^[\p{L}\p{N} .'&-]+$/u.test(canonical)) {
    return "Only letters, numbers, spaces and . ' & - are allowed.";
  }
  return null;
}

/**
 * Typing-time availability (advisory — the save transaction is the real
 * gate). Requires the extended backend; a 404 from an older deployment is
 * surfaced as { deployed: false } so the UI can degrade honestly.
 */
export async function checkStoreName(
  name: string
): Promise<
  | { deployed: true; available: boolean; reason: string | null; message?: string }
  | { deployed: false }
> {
  try {
    const res = await j<{ ok: boolean; available: boolean; reason: string | null; message?: string }>(
      `/api/profile/seller-onboarding/store-name-check?name=${encodeURIComponent(name)}`,
      { method: 'GET' },
      true
    );
    return { deployed: true, available: res.available, reason: res.reason, message: res.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // Old deployment: route doesn't exist yet (404 or the SPA's HTML page).
    if (/HTTP 404|<!doctype|<html/i.test(msg)) return { deployed: false };
    throw e;
  }
}

export function saveSellerTaxStatus(taxStatus: TaxStatus) {
  return j<{ ok: boolean; taxStatus: TaxStatus }>(
    '/api/profile/seller-onboarding/tax-status',
    { method: 'POST', body: JSON.stringify({ taxStatus }) },
    true
  );
}

/**
 * `client: 'app'` asks the backend to use the app's custom-scheme redirect so
 * the in-app browser closes itself after consent. Older deployments ignore the
 * field and fall back to the website redirect — the flow still completes via
 * the resume check, just less seamlessly.
 */
export function initDigiLocker() {
  return j<{ sessionId: string; authUrl: string }>(
    '/api/digilocker/init',
    { method: 'POST', body: JSON.stringify({ client: 'app' }) },
    true
  );
}

export function completeDigiLocker(sessionId: string) {
  return j<{
    verified: boolean;
    error?: string;
    message?: string;
    accountName?: string;
    aadhaarName?: string;
    maskedAadhaar?: string;
  }>('/api/digilocker/complete', { method: 'POST', body: JSON.stringify({ sessionId }) }, true);
}

export function verifyPan(pan: string, dateOfBirth?: string) {
  return j<{
    verified: boolean;
    error?: string;
    message?: string;
    panName?: string;
    maskedPan?: string;
  }>(
    '/api/pan/verify',
    { method: 'POST', body: JSON.stringify(dateOfBirth ? { pan, dateOfBirth } : { pan }) },
    true
  );
}

/** GSTIN structure: 2-digit State, 10-char PAN, entity digit, 'Z', check char.
 *  Structure only — the backend decides whether it is a real registration. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** GST-portal enrolment id for unregistered suppliers: 15 alphanumeric. */
export const ENROLMENT_RE = /^[0-9A-Z]{15}$/;

/** Strip anything a GSTIN/enrolment id can't contain and normalise casing. */
export function normaliseTaxId(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export interface GstVerifyResult {
  verified: boolean;
  status: 'verified' | 'manual_review' | 'mismatch' | 'rejected';
  /** True when the backend replayed an earlier verification instead of
   *  paying for another provider lookup. */
  reused?: boolean;
  error?: string;
  message?: string;
  legalName: string | null;
  tradeName?: string | null;
  taxpayerType?: string | null;
  registrationStatus?: string | null;
  principalPlace?: string | null;
  effectiveDate?: string | null;
  stateCode?: string | null;
  reviewReason?: string | null;
  /** Which type the seller's Tax Details choice required, on a mismatch. */
  expected?: string | null;
  maskedGstin: string;
}

export function verifyGst(gstin: string, stateCode: string, legalName?: string) {
  const body: Record<string, string> = { gstin, stateCode };
  if (legalName && legalName.trim()) body.legalName = legalName.trim();
  return j<GstVerifyResult>('/api/gst/verify', { method: 'POST', body: JSON.stringify(body) }, true);
}

export type TurnoverBand = 'under_20l' | '20l_40l' | 'over_40l_registering';

/** The only turnover bands the backend accepts (profileRouter TURNOVER_BANDS).
 *  Single source for the UI so the two can't drift apart.
 *
 *  These are Any&All's own onboarding bands, used to triage a seller for
 *  compliance review — they are not a statement of the statutory registration
 *  threshold, which depends on the seller's State and what they supply. */
export const TURNOVER_BANDS: { value: TurnoverBand; label: string }[] = [
  { value: 'under_20l', label: 'Under ₹20 lakh' },
  { value: '20l_40l', label: '₹20–40 lakh' },
  { value: 'over_40l_registering', label: 'Above ₹40 lakh (I am obtaining registration)' },
];

export type DeclarationKey =
  | 'eligibleTurnover'
  | 'subjectToLaw'
  | 'intraStateOnly'
  | 'singleState'
  | 'notifyChanges'
  | 'noGstCharging';

export type Declarations = Record<DeclarationKey, boolean>;

/** Every declaration an unregistered seller must accept, in display order.
 *  Keys match profileRouter's ENROLMENT_DECLARATIONS; the backend stores which
 *  ones were ticked plus a version stamp, so wording can change safely. */
export const ENROLMENT_DECLARATIONS: { key: DeclarationKey; text: string }[] = [
  {
    key: 'eligibleTurnover',
    text: 'My aggregate turnover remains within the eligibility conditions applicable to selling as an unregistered supplier.',
  },
  {
    key: 'subjectToLaw',
    text: 'I understand that selling without GST registration through an e-commerce operator is subject to applicable law and eligibility conditions.',
  },
  {
    key: 'intraStateOnly',
    text: 'I may sell only within the State/UT permitted under this enrolment unless my tax-registration status changes.',
  },
  {
    key: 'singleState',
    text: 'I will supply through Any&All using the declared State/UT associated with this enrolment.',
  },
  {
    key: 'notifyChanges',
    text: 'I will inform Any&All if my GST registration status, turnover, operating State/UT or eligibility changes.',
  },
  {
    key: 'noGstCharging',
    text: 'I will not represent myself as a GST-registered supplier or charge GST unless I am lawfully registered and permitted to do so.',
  },
];

export const NO_DECLARATIONS: Declarations = {
  eligibleTurnover: false,
  subjectToLaw: false,
  intraStateOnly: false,
  singleState: false,
  notifyChanges: false,
  noGstCharging: false,
};

export function submitEnrolment(payload: {
  enrolmentNumber: string;
  stateCode: string;
  turnoverBand: TurnoverBand;
  address: string;
  declarations: Declarations;
}) {
  return j<{ ok: boolean; enrolmentVerificationStatus: 'pending' }>(
    '/api/profile/seller-onboarding/enrolment',
    { method: 'POST', body: JSON.stringify(payload) },
    true
  );
}

/** Indian IFSC: 4-letter bank code, a literal 0, then 6 alphanumeric.
 *  Mirrors VALID_IFSC in functions/bankRouter.js. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Account number range the provider accepts (VALID_ACC in bankRouter.js). */
export const ACCOUNT_RE = /^\d{9,18}$/;

export interface BankVerifyResult {
  verified: boolean;
  status?: 'verified' | 'rejected' | 'name_mismatch' | 'manual_review' | 'provider_unavailable';
  error?: string;
  message?: string;
  /** Initials only (e.g. "S••••• K•••••") — never the full holder name. */
  bankNameHint?: string;
  maskedAccount?: string;
  maskedIfsc?: string;
  ifsc?: string;
}

export function verifyBank(accountNumber: string, ifsc: string) {
  return j<BankVerifyResult>(
    '/api/bank/verify',
    { method: 'POST', body: JSON.stringify({ accountNumber, ifsc }) },
    true
  );
}

/** Production Seller Terms. Same page that backs sign-up, the Seller Hub intro
 *  and the support knowledge base; the seller section is anchored. */
/** Pauses the storefront. Persisted server-side so it survives a restart and
 *  so order handling can enforce it — never a local-only switch. */
export function setVacationMode(enabled: boolean) {
  return j<{ ok: boolean; vacationMode: boolean }>(
    '/api/profile/seller-onboarding/vacation-mode',
    { method: 'POST', body: JSON.stringify({ enabled }) },
    true
  );
}

export const SELLER_TERMS_URL = 'https://anynall.com/terms#seller-onboarding';

/** The second confirmation on the Agreement step is specific to how the seller
 *  is registered — showing everyone the same restriction would be wrong for
 *  two of the three paths.
 *
 *  The composition and unregistered wording reflects what the backend actually
 *  enforces: functions/sellerTaxPolicy.js blocks inter-State orders for both
 *  (`interstateSalesAllowed` is false unless the seller is regular GST), so
 *  this is a real product rule, not boilerplate. */
export const TAX_ACKNOWLEDGEMENT: Record<TaxStatus, string> = {
  unregistered_enrolled:
    'I understand that my selling activity is subject to the eligibility and State/UT restrictions applicable to my unregistered seller enrolment.',
  composition:
    'I understand that my account is restricted to orders within my registered State/UT under the composition scheme, and that Any&All enforces this on every order.',
  regular_gst:
    'I confirm that my GST registration information is current, and I will notify Any&All if my tax-registration status changes.',
};

/** `version` is the terms version the app actually rendered. The backend
 *  rejects it with TERMS_VERSION_CHANGED if the terms moved on meanwhile, so
 *  consent can never be recorded against text the seller didn't see. */
export function acceptSellerAgreement(version?: string) {
  return j<{ ok: boolean; version: string; alreadyAccepted?: boolean; acceptedAt?: string | null }>(
    '/api/profile/seller-onboarding/agreement',
    { method: 'POST', body: JSON.stringify(version ? { version } : {}) },
    true
  );
}

export function completeSellerOnboarding() {
  return j<{ ok: boolean; applicationStatus: ApplicationStatus; applicationId?: string | null; alreadySubmitted?: boolean }>(
    '/api/profile/seller-onboarding/complete',
    { method: 'POST', body: '{}' },
    true
  );
}
