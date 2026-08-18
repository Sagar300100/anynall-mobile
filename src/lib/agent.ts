// src/lib/agent.ts — generic streaming client for the secure LLM gateway
// (functions/agentRouter.js, POST /api/agent/:agentId/chat). The mobile port
// of the website's streamAgent() in services/agent.ts.
//
// Unlike the support agent (lib/support-agent.ts), generic agents stream
// PLAIN TEXT with no metadata trailer — the whole body is the visible reply.
// Same XHR transport for the same reason: React Native's fetch cannot read a
// partial body, and a caption generator that says nothing until it says
// everything feels broken.
//
// Auth + App Check are enforced server-side (verified email required); the
// per-user daily token budget is the server's too — a 429 surfaces its
// message verbatim.
import { getIdToken } from 'firebase/auth';

import { auth, getAppCheckHeader } from './firebase';

const BASE = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const STREAM_TIMEOUT_MS = 90_000;

export type AgentMessage = { role: 'user' | 'assistant'; content: string };

export interface AgentStream {
  /** Resolves with the full reply text once the stream completes. */
  promise: Promise<string>;
  /** Abort the request — call when the screen unmounts. */
  cancel: () => void;
}

/**
 * Stream a reply from a named agent (e.g. 'marketing'). `onDelta` receives
 * each new chunk of text as it arrives; the promise resolves with the
 * complete reply.
 */
export function streamAgent(
  agentId: string,
  messages: AgentMessage[],
  onDelta: (text: string) => void
): AgentStream {
  const xhr = new XMLHttpRequest();
  let cancelled = false;

  const promise = new Promise<string>((resolve, reject) => {
    let emitted = 0;
    let settled = false;

    function fail(message: string) {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }

    function pump() {
      let text = '';
      try {
        text = xhr.responseText || '';
      } catch {
        return;
      }
      if (text.length > emitted) {
        onDelta(text.slice(emitted));
        emitted = text.length;
      }
    }

    xhr.onreadystatechange = () => {
      if (cancelled) return;
      if (xhr.readyState === XMLHttpRequest.LOADING) {
        if (xhr.status >= 200 && xhr.status < 300) pump();
        return;
      }
      if (xhr.readyState !== XMLHttpRequest.DONE) return;

      if (xhr.status >= 200 && xhr.status < 300) {
        pump();
        if (!settled) {
          settled = true;
          resolve(xhr.responseText || '');
        }
        return;
      }
      if (!xhr.status) {
        fail('We couldn’t reach the assistant. Check your connection and try again.');
        return;
      }
      let message = `The assistant is unavailable (${xhr.status}).`;
      try {
        const body = JSON.parse(xhr.responseText || '{}');
        if (body?.message) message = body.message;
        else if (body?.error === 'AGENT_UNAVAILABLE') message = 'The assistant is offline right now.';
      } catch {
        /* non-JSON error body */
      }
      fail(message);
    };

    xhr.onerror = () =>
      fail('We couldn’t reach the assistant. Check your connection and try again.');
    xhr.ontimeout = () => fail('The assistant took too long to reply. Please try again.');

    (async () => {
      try {
        xhr.open('POST', `${BASE}/api/agent/${encodeURIComponent(agentId)}/chat`);
        xhr.timeout = STREAM_TIMEOUT_MS;
        xhr.setRequestHeader('Content-Type', 'application/json');
        const appCheck = await getAppCheckHeader();
        for (const [k, v] of Object.entries(appCheck)) xhr.setRequestHeader(k, v);
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
