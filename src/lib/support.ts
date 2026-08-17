// src/lib/support.ts — mobile port of the web app's services/support.ts plus
// the support helpers in services/api.ts, against functions/supportRouter.js.
//
// Four real endpoints, three different auth rules — they are NOT
// interchangeable, so each one below states which it uses:
//
//   POST /api/support/ticket          auth OPTIONAL (App Check only)
//   POST /api/support/escalate        auth REQUIRED
//   GET  /api/support/my-escalations  auth REQUIRED
//   POST /api/support/feedback        auth REQUIRED
//
// The ticket intake stays open to signed-out users on purpose: "I can't log
// in" is itself a support category, and gating it behind sign-in would lock
// out exactly the people who need it most.
import { getIdToken } from 'firebase/auth';

import { j } from './api';
import { auth, getAppCheckHeader } from './firebase';

const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

// ── Categories ─────────────────────────────────────────────────────────────
// This union must stay identical to CATEGORIES in functions/supportRouter.js:
// the server 400s on anything outside the set, and the value also decides the
// queue (privacy_data → privacy@, grievance_safety → grievance@, rest →
// support@). Do not add a category here before the server accepts it.
export type TicketCategory =
  | 'order_issue'
  | 'refund_return'
  | 'payment_issue'
  | 'delivery_issue'
  | 'seller_issue'
  | 'account_login'
  | 'live_show'
  | 'privacy_data'
  | 'grievance_safety'
  | 'other';

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  order_issue: 'Order issue',
  refund_return: 'Return / refund',
  payment_issue: 'Payment',
  delivery_issue: 'Delivery',
  seller_issue: 'Seller',
  account_login: 'Account / login',
  live_show: 'Live show',
  privacy_data: 'Privacy / data',
  grievance_safety: 'Grievance / safety',
  other: 'Other',
};

export interface TicketPayload {
  category: TicketCategory;
  name: string;
  email: string;
  phone?: string;
  subject: string;
  description: string;
  /** Category-specific extra fields (order id, payment ref, …). */
  details?: Record<string, string>;
}

export interface TicketResult {
  ticketId: string;
  queue: 'support' | 'privacy' | 'grievance';
}

/**
 * Server-side validation failure. The server returns a per-field map, and the
 * form needs it field-by-field to mark the offending inputs — a flattened
 * message would force the user to hunt for what's wrong.
 */
export class TicketValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] || 'Please check the form and try again.');
    this.name = 'TicketValidationError';
    this.fields = fields;
  }
}

/**
 * Submit a support ticket (POST /api/support/ticket).
 *
 * Hand-rolled rather than routed through `j()` because this call is the one
 * place that needs the 400 body: `j()` collapses errors into "HTTP 400 …",
 * which would throw away the per-field messages the form renders.
 */
export async function submitTicket(payload: TicketPayload): Promise<TicketResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await getAppCheckHeader()),
  };
  // Best-effort identity: it gives the queue context, but a failure here must
  // never block the ticket — signed-out submissions are supported.
  const u = auth.currentUser;
  if (u) {
    try {
      headers.Authorization = `Bearer ${await getIdToken(u, false)}`;
    } catch {
      /* stale token — the server just treats this as a signed-out ticket */
    }
  }

  const res = await fetch(`${BASE}/api/support/ticket`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}) as any);
  if (!res.ok) {
    if (body?.error === 'VALIDATION_FAILED' && body?.fields && typeof body.fields === 'object') {
      throw new TicketValidationError(body.fields as Record<string, string>);
    }
    if (body?.error === 'RATE_LIMITED') {
      throw new Error(
        body?.message || 'Too many tickets from this connection. Please try again later.'
      );
    }
    throw new Error(body?.message || `Could not submit your ticket (${res.status}).`);
  }
  return body as TicketResult;
}

// ── My tickets ─────────────────────────────────────────────────────────────
export interface MyTicket {
  /** "TKT-1A2B3C4D" for form tickets, "#12345" for Zoho-numbered escalations. */
  reference: string;
  subject: string | null;
  category: string;
  status: string;
  /** Epoch millis, or null when the server hasn't stamped it yet. */
  createdAt: number | null;
  /** "ai_assistant" for assistant escalations, otherwise "web"/"mobile". */
  source: string;
}

/**
 * The signed-in user's tickets, newest first (GET /api/support/my-escalations).
 * Scoped to the caller's uid server-side — this can never read anyone else's.
 */
export async function listMyTickets(): Promise<MyTicket[]> {
  const data = await j<{ tickets: MyTicket[] }>(
    '/api/support/my-escalations',
    { method: 'GET' },
    /* needsAuth */ true
  );
  return Array.isArray(data?.tickets) ? data.tickets : [];
}

// ── Assistant escalation ───────────────────────────────────────────────────
export type EscalationReason =
  | 'no_source_found'
  | 'model_low_confidence'
  | 'user_requested_agent'
  | 'didnt_help'
  | 'high_risk_category'
  | 'upstream_error'
  | 'repeated_failure';

export interface EscalationPayload {
  /** Stable per-chat id so repeat escalations update one ticket, not many. */
  sessionId: string;
  category: TicketCategory;
  subject: string;
  summary: string;
  reason: EscalationReason;
  orderId?: string;
  /** Which screen the user was on — plain context for the support agent. */
  page?: string;
  sources?: string[];
  transcript: { role: 'user' | 'assistant'; content: string }[];
}

export interface EscalationResult {
  mode: 'api' | 'email';
  ticketNumber?: string | number | null;
  reference: string;
  status: string;
  updated: boolean;
}

/**
 * Hand an assistant conversation to the human support queue
 * (POST /api/support/escalate). Name and email are NOT sent: the server takes
 * the trusted values from Auth + Firestore and ignores anything the client
 * claims about identity.
 */
export async function escalateSupport(payload: EscalationPayload): Promise<EscalationResult> {
  return j<EscalationResult>(
    '/api/support/escalate',
    { method: 'POST', body: JSON.stringify(payload) },
    /* needsAuth */ true
  );
}

/**
 * Was that assistant answer useful? (POST /api/support/feedback)
 *
 * Stores the question and the verdict only — no transcript — so unanswered
 * questions can drive new Help Center content. Callers fire-and-forget this:
 * a failed vote must never interrupt the conversation.
 */
export async function sendSupportFeedback(question: string, helpful: boolean): Promise<void> {
  await j<{ ok: boolean }>(
    '/api/support/feedback',
    { method: 'POST', body: JSON.stringify({ question: question.slice(0, 500), helpful }) },
    /* needsAuth */ true
  );
}
