// Buyer protection (spec Gap 2) — escrow + 24h complaint window clients.
//
// The contract (docs/marketplace-gaps-spec.md): orders gain `deliveredAt`,
// `complaintWindowEndsAt` (= deliveredAt + 24h) and `protection.status`
// (`in_window` → `released` | `disputed`). The buyer files ONE complaint
// inside the window — category + note + a REQUIRED unboxing video already in
// Storage under `unboxing/{buyerUid}/{orderId}/…` (lib/unboxing.ts owns that
// path). The seller (or admin) resolves with refund or release.
//
// The backend endpoints are being built in parallel against the same spec.
// Until they deploy, every call here 404s — callers use isEndpointMissing()
// to show honest "not available yet" copy instead of a raw error, and no
// screen may crash on the miss.
import { j } from './api';

// ── Complaint categories (the spec's exact five values) ────────────────────

export type ComplaintCategory =
  | 'damaged'
  | 'wrong_item'
  | 'counterfeit'
  | 'not_as_described'
  | 'missing';

export const COMPLAINT_CATEGORIES: {
  value: ComplaintCategory;
  label: string;
  hint: string;
}[] = [
  { value: 'damaged', label: 'Arrived damaged', hint: 'Broken or harmed in transit' },
  { value: 'wrong_item', label: 'Wrong item', hint: 'Not the item you bought' },
  { value: 'counterfeit', label: 'Counterfeit', hint: 'Not the authentic item it claimed to be' },
  {
    value: 'not_as_described',
    label: 'Not as described',
    hint: 'Condition or details don’t match the listing',
  },
  { value: 'missing', label: 'Missing item or parts', hint: 'The package arrived incomplete' },
];

/** Server rule: complaint notes are capped at 2000 characters. */
export const COMPLAINT_NOTE_MAX = 2000;

/** Human label for a stored category value — never raw snake_case on screen. */
export function complaintCategoryLabel(value: string | null | undefined): string {
  const hit = COMPLAINT_CATEGORIES.find((cat) => cat.value === value);
  if (hit) return hit.label;
  return String(value || 'Problem')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Protection status vocabulary (mirrors lib/seller-hub's ORDER_STATUS) ───

export type ProtectionStatus = 'in_window' | 'disputed' | 'released' | 'refunded_pending';

/** protection.status → label + tone, same idiom as ORDER_STATUS so both
 *  order lists render protection chips with the same tone→colour mapping. */
export const PROTECTION_STATUS: Record<
  string,
  { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }
> = {
  in_window: { label: 'Protection active', tone: 'ok' },
  disputed: { label: 'Under review', tone: 'warn' },
  released: { label: 'Payment released', tone: 'muted' },
  refunded_pending: { label: 'Refund on its way', tone: 'warn' },
};

// ── Order-doc shapes (additive — ride on both order list responses) ────────

/** `orders/{id}.protection` as the spec writes it. `releasedAt` is optional
 *  extra context from the release sweep; absent on older docs. */
export interface OrderProtection {
  status: ProtectionStatus | string;
  releasedAt?: string | null;
}

/** `orders/{id}.dispute` once a complaint is filed. */
export interface OrderDispute {
  category: ComplaintCategory | string;
  note?: string | null;
  /** Storage path under unboxing/{buyerUid}/{orderId}/… */
  videoPath?: string | null;
  filedAt?: string | null;
  /** Present after POST /:id/resolve. */
  resolution?: 'refund' | 'release' | string | null;
  resolvedAt?: string | null;
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/** Buyer files the one complaint the window allows
 *  (POST /api/orders/:id/complaint). `videoPath` is REQUIRED by the server —
 *  it must exist in Storage under the caller's own unboxing path. */
export function fileComplaint(
  orderId: string,
  p: { category: ComplaintCategory; note?: string; videoPath: string }
) {
  return j<{ ok: boolean }>(
    `/api/orders/${encodeURIComponent(orderId)}/complaint`,
    {
      method: 'POST',
      body: JSON.stringify({
        category: p.category,
        note: (p.note || '').slice(0, COMPLAINT_NOTE_MAX),
        videoPath: p.videoPath,
      }),
    },
    true
  );
}

/** Seller fallback for COD/self-ship: stamp the order delivered NOW
 *  (POST /api/orders/:id/delivered). Starts the buyer's 24h window — the
 *  confirm dialog in the UI must make that consequence explicit. */
export function markDelivered(orderId: string) {
  return j<{ ok: boolean; deliveredAt?: string; complaintWindowEndsAt?: string }>(
    `/api/orders/${encodeURIComponent(orderId)}/delivered`,
    { method: 'POST', body: JSON.stringify({}) },
    true
  );
}

/** Seller (or admin) resolves a dispute (POST /api/orders/:id/resolve):
 *  `refund` concedes (refund due to the buyer), `release` pays the seller. */
export function resolveDispute(
  orderId: string,
  p: { resolution: 'refund' | 'release'; note?: string }
) {
  return j<{ ok: boolean }>(
    `/api/orders/${encodeURIComponent(orderId)}/resolve`,
    { method: 'POST', body: JSON.stringify(p) },
    true
  );
}

// ── Fail-soft helpers ──────────────────────────────────────────────────────

/** True when a thrown j() error means the endpoint isn't deployed yet
 *  (backend wave in flight). j() throws "HTTP 404 …" for that case. */
export function isEndpointMissing(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /^HTTP 404\b/.test(text);
}

/** The server's own human sentence out of a j() error, or the fallback —
 *  same idiom as lib/seller-hub.serverMessage. */
export function protectionErrorMessage(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : String(err);
  const m = text.match(/"message"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? fallback;
}
