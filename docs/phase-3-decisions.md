# Phase 3 product decisions (taken, reversible — review with mentor)

Two Phase 3 items required a product decision. Both were resolved by the same
rule: **the deployed contract (firestore.rules + the web client) wins**, because
it's live in production and mobile is the surface that must conform. Either can
be reversed later, but reversal is a two-repo change (rules + web), not a
mobile-only one.

## 1. Private accounts: IMPLEMENTED on mobile

The rules enforce Instagram-style privacy (direct follows blocked for private
targets; `followRequests` with a target-accept path) and the web ships the full
flow including a privacy toggle. Mobile previously declared "there are no
private accounts" and broke against the rules (Follow on a private account
failed with a generic error forever).

Mobile now has: `isPrivate` in profiles, follow → request → accept/decline
lifecycle, a Requests surface in Messages, private-profile rendering (lock
state, hidden content until accepted), and a Private-account toggle in
settings — all writing the exact Firestore shapes the web writes.

**To reverse instead** (kill privacy platform-wide): remove the `isPrivate`
gate from firestore.rules' follows create, drop `followRequests` from rules,
remove the web toggle + request flow, and simplify mobile back. Do it in that
order or follows break on both clients.

## 2. DM "message requests": REMOVED from mobile

The pending/accept gate existed only inside the mobile client — the rules
never enforced it and the web never rendered it, so it was a false promise:
declines stopped nothing, and requesters whose recipient replied from web saw
"they can reply once they accept" under an active two-way chat. Mobile now
matches the web: conversations open directly.

**To do it properly later** (both clients): add `status`/`requesterId` to the
conversations schema in firestore.rules with a message-create condition
(sender must be requester-only until accepted), implement accept/decline on
BOTH clients, and migrate existing docs. Until the rules enforce it, any
client-side version is theatre.

## 3. Replays for mobile-hosted shows: deliberate no-build

See `replays-decision.md` — client-side recording is the wrong architecture on
RN; the durable fix is LiveKit Room Composite Egress server-side, which would
replace the web's fragile MediaRecorder path too.
