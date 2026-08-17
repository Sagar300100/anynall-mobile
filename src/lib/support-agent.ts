// src/lib/support-agent.ts — mobile port of the web app's services/agent.ts
// (streamSupportAgent) against functions/supportAgentRouter.js.
//
// WHY XMLHttpRequest AND NOT fetch
// The web client reads the streamed reply with `res.body.getReader()`. React
// Native's fetch is XHR-backed and does NOT expose `response.body` — it
// resolves only once the whole body has arrived, which would turn a streaming
// assistant into a blank screen followed by a wall of text. XHR is the one
// transport in React Native that hands over a partial body: `responseText`
// grows while readyState is LOADING(3), so we diff it and emit the delta.
//
// WIRE FORMAT (must match the server exactly)
// The response is plain text: the visible answer, then a newline, then
// "@@SUPPORT_META@@" followed by a JSON trailer. The sentinel can straddle two
// reads, so the tail of each read is held back until it's provably not the
// start of one — otherwise "@@SUPPO" would flash on screen mid-answer.
import { getIdToken } from 'firebase/auth';

import { auth, getAppCheckHeader } from './firebase';

const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const META_SENTINEL = '@@SUPPORT_META@@';
/** Held-back tail: the sentinel itself, plus the newline the server puts
 *  before it, plus one for luck. Never emit inside this window. */
const HOLD_BACK = META_SENTINEL.length + 2;

/** The model can think for a while before the first token; be generous. */
const STREAM_TIMEOUT_MS = 90_000;

export type AgentMessage = { role: 'user' | 'assistant'; content: string };

export interface SupportSource {
  doc: string;
  title: string;
  url: string | null;
}

export interface SupportMeta {
  /** Help Center / policy documents the answer was grounded in. */
  sources: SupportSource[];
  /** The server decided this needs a human — offer to raise a ticket. */
  escalate: boolean;
  reason: string | null;
  category: string | null;
  highRisk: boolean;
}

const EMPTY_META: SupportMeta = {
  sources: [],
  escalate: false,
  reason: null,
  category: null,
  highRisk: false,
};

export interface AgentStream {
  /** Resolves with the trailer once the reply is complete. */
  promise: Promise<SupportMeta>;
  /** Abort the request — call this when the screen unmounts. */
  cancel: () => void;
}

/**
 * Stream a reply from the grounded support agent.
 *
 * `onDelta` receives visible text only: the sentinel and everything after it
 * are stripped before it ever reaches the UI.
 */
export function streamSupportAgent(
  messages: AgentMessage[],
  onDelta: (text: string) => void
): AgentStream {
  const xhr = new XMLHttpRequest();
  let cancelled = false;

  const promise = new Promise<SupportMeta>((resolve, reject) => {
    // How much of responseText has already been handed to onDelta. Indices are
    // stable because responseText only ever grows.
    let emitted = 0;
    // Index of the sentinel once seen; after that nothing more is visible.
    let sentinelAt = -1;
    let settled = false;

    function fail(message: string) {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }

    /** Emit whatever new visible text is safe to show. */
    function pump(final: boolean) {
      let text = '';
      try {
        text = xhr.responseText || '';
      } catch {
        return; // some readyStates make responseText unreadable — wait
      }
      if (sentinelAt !== -1) return; // past the sentinel: nothing left to show

      const at = text.indexOf(META_SENTINEL, emitted);
      if (at !== -1) {
        sentinelAt = at;
        // Drop the single newline the server writes before the sentinel.
        const visible = text.slice(emitted, at).replace(/\n$/, '');
        if (visible) onDelta(visible);
        emitted = at;
        return;
      }

      // No sentinel yet. While streaming, keep back enough characters that a
      // half-arrived sentinel can't leak into the UI.
      const safeEnd = final ? text.length : text.length - HOLD_BACK;
      if (safeEnd > emitted) {
        onDelta(text.slice(emitted, safeEnd));
        emitted = safeEnd;
      }
    }

    function finish() {
      if (settled) return;
      pump(/* final */ true);
      settled = true;

      if (sentinelAt === -1) {
        // Server ended without a trailer (older build, or a truncated
        // response). The answer still showed, so treat it as "no metadata"
        // rather than an error — but never invent an escalation.
        resolve(EMPTY_META);
        return;
      }
      const raw = (xhr.responseText || '').slice(sentinelAt + META_SENTINEL.length).trim();
      try {
        const parsed = JSON.parse(raw);
        resolve({
          sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
          escalate: !!parsed?.escalate,
          reason: parsed?.reason || null,
          category: parsed?.category || null,
          highRisk: !!parsed?.highRisk,
        });
      } catch {
        resolve(EMPTY_META);
      }
    }

    xhr.onreadystatechange = () => {
      if (cancelled) return;
      if (xhr.readyState === XMLHttpRequest.LOADING) {
        // Only stream the happy path — an error body is JSON, not an answer.
        if (xhr.status >= 200 && xhr.status < 300) pump(/* final */ false);
        return;
      }
      if (xhr.readyState !== XMLHttpRequest.DONE) return;

      if (xhr.status >= 200 && xhr.status < 300) {
        finish();
        return;
      }
      // status 0 with no body is the network/abort case.
      if (!xhr.status) {
        fail('We couldn’t reach the assistant. Check your connection and try again.');
        return;
      }
      let message = `The assistant is unavailable (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText || '{}');
        if (body?.message) message = body.message;
        else if (body?.error === 'AGENT_UNAVAILABLE')
          message = 'The assistant is offline right now. You can still raise a ticket.';
      } catch {
        /* non-JSON error body — keep the status message */
      }
      fail(message);
    };

    xhr.onerror = () =>
      fail('We couldn’t reach the assistant. Check your connection and try again.');
    xhr.ontimeout = () => fail('The assistant took too long to reply. Please try again.');

    (async () => {
      try {
        xhr.open('POST', `${BASE}/api/support-agent/chat`);
        xhr.timeout = STREAM_TIMEOUT_MS;
        xhr.setRequestHeader('Content-Type', 'application/json');

        const appCheck = await getAppCheckHeader();
        for (const [k, v] of Object.entries(appCheck)) xhr.setRequestHeader(k, v);

        // Auth is REQUIRED here (the route is authGuard + verified email), but
        // a token failure shouldn't crash the screen — let the server 401 and
        // surface its message like any other error.
        const u = auth.currentUser;
        if (u) {
          try {
            xhr.setRequestHeader('Authorization', `Bearer ${await getIdToken(u, false)}`);
          } catch {
            /* server will answer 401 */
          }
        }

        if (cancelled) return;
        xhr.send(JSON.stringify({ messages }));
      } catch {
        fail('We couldn’t start the assistant. Please try again.');
      }
    })();
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        xhr.abort();
      } catch {
        /* already finished */
      }
    },
  };
}
