// Referral credits + first-purchase discount (spec Gap 6) — client side.
//
// The balance lives server-only at `users/{uid}.creditPaise` and is surfaced
// on GET /api/commerce/profile as `creditPaise` once the backend wave lands.
// Until then the field is simply absent and every reader treats that as 0 —
// a missing balance must hide the credit UI, never invent a number.
//
// Redeeming (`POST /api/referral/redeem { code }`) is valid once per account,
// only before the first paid order, never on your own code. The credit itself
// (+₹100 to both parties by default) is granted server-side on the first PAID
// order — redeeming alone moves no money, and the UI copy says so.
import { j } from './api';

/** The signed-in buyer's credit balance in paise. Reads it off the commerce
 *  profile (`creditPaise`); absent field or any failure → 0, so the credit UI
 *  disappears rather than blocking or lying. */
export async function getCreditBalance(): Promise<number> {
  try {
    const p = await j<{ creditPaise?: number }>('/api/commerce/profile', { method: 'GET' }, true);
    const n = p?.creditPaise;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

/** Redeem a referral code (the referrer's username). Throws j()'s error on
 *  refusal — feed it to referralRedeemError() for buyer-facing copy. */
export function redeemReferral(code: string) {
  return j<{ ok: boolean }>(
    '/api/referral/redeem',
    { method: 'POST', body: JSON.stringify({ code: code.trim().replace(/^@/, '') }) },
    true
  );
}

/** Buyer-facing copy for a failed redeem. `terminal` = this account can never
 *  redeem (already redeemed / already made a purchase), so entry points may
 *  softly hide themselves. Honest on the 404: the backend isn't deployed yet. */
export function referralRedeemError(err: unknown): { message: string; terminal: boolean } {
  const text = err instanceof Error ? err.message : String(err);
  if (/^HTTP 404\b/.test(text)) {
    return {
      message: 'Referral codes aren’t live just yet — hold onto it and try again soon.',
      terminal: false,
    };
  }
  const m = text.match(/"message"\s*:\s*"([^"]+)"/);
  if (/MUTUAL_REFERRAL/i.test(text)) {
    return {
      message: 'You can’t use the code of someone you referred — pick a different code.',
      terminal: false,
    };
  }
  if (/ALREADY|REDEEMED|REFERRED/i.test(text)) {
    return {
      message: m?.[1] ?? 'A referral code was already applied to this account.',
      terminal: true,
    };
  }
  if (/FIRST|PAID|PURCHAS/i.test(text)) {
    return {
      message: m?.[1] ?? 'Referral codes only work before your first purchase.',
      terminal: true,
    };
  }
  if (/SELF/i.test(text)) {
    return { message: m?.[1] ?? 'You can’t use your own code.', terminal: false };
  }
  if (/NOT_FOUND|INVALID|UNKNOWN/i.test(text)) {
    return { message: m?.[1] ?? 'That code doesn’t match any member — check the spelling.', terminal: false };
  }
  return {
    message: m?.[1] ?? 'Couldn’t apply the code right now. Please try again.',
    terminal: false,
  };
}

/** Paise the buyer can actually spend on a given total: the server deducts
 *  `min(creditPaise, total − ₹1)` (a ₹1 minimum charge keeps Razorpay happy).
 *  Mirrored here ONLY for display — the server's transaction decides. */
export function spendableCredit(creditPaise: number, totalPaise: number): number {
  return Math.max(0, Math.min(creditPaise, totalPaise - 100));
}

/** Normalise the order-response `firstBuyDiscount` field to paise. The spec
 *  records it on the order and "surfaces it in the response for UI" without
 *  pinning a shape, so accept the two honest encodings: a paise number, or an
 *  object carrying `amountPaise`. Anything else → 0 (no line shown). */
export function discountAmountPaise(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (v && typeof v === 'object') {
    const n = (v as { amountPaise?: unknown }).amountPaise;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}
