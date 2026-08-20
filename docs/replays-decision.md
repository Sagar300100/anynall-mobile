# Replays for mobile-hosted shows: decision record

## The gap

Web-hosted shows get replays because the web host records **client-side**
(`services/streaming.ts` — MediaRecorder on the local stream), uploads to
Storage at `replays/{uid}/show_{showId}.{ext}`, and stamps `replay_url` on the
show doc at end. The mobile host path records nothing, so **mobile-hosted shows
never appear on the Replays rails of either client** — including the mobile
app's own replay player.

## Decision: do NOT port client-side recording to mobile (for now)

Porting the web's approach to React Native is the wrong build:

- There is no MediaRecorder in RN; recording the LiveKit local track to a file
  needs native modules the project doesn't carry, wired into the same camera
  session LiveKit is already publishing from — high crash-risk surface on
  exactly the screen that earns the money.
- Client-side recording is the **fragile architecture even on web**: it costs
  the host's battery/storage/uplink, produces nothing if the app dies mid-show
  (the case that already loses streams), and the upload of a multi-hundred-MB
  file over Indian mobile uplinks at show-end routinely fails.

So mobile-hosted shows knowingly ship without replays this phase. Buyer-side
replay surfaces (rails, player) already work for web-hosted shows and are
untouched.

## The durable fix (recommended next backend step): LiveKit Egress

Server-side recording fixes BOTH hosts and removes the client from the loop:

1. Enable **Room Composite Egress** on the LiveKit project, output to GCS/S3
   (LiveKit Cloud supports direct-to-bucket).
2. `functions/streamRouter.js`: on the FIRST host-token mint for a room, start
   an egress for `show_{showId}` (LiveKit server SDK); record the egress id on
   `liveRooms/{showId}`.
3. On `/api/stream/end` (and the stale-room sweep), stop the egress, wait for
   the file, write `replay_url` onto `shows/{showId}` — same field both
   clients already read.
4. Web can then delete its MediaRecorder path too; one pipeline, both surfaces.

Costs to check before committing: LiveKit egress minutes pricing vs. show
volume; storage lifecycle for old replays (align with the Firestore TTL work
in Phase 4).
