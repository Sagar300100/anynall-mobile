// Live viewer count — LiveKit IS the presence system (spec Gap 8).
//
// No backend presence collection exists, and none is needed: the connected
// Room already knows exactly who is in it. The count is
// `remoteParticipants.size + 1` — the +1 is this device — updated on
// participant joins/leaves and connection transitions. Approximate by design:
// on the buyer side the host is one of the remote participants; on the seller
// side the +1 is the seller themselves. Null whenever the room isn't
// connected, so the pill can show "—" instead of a stale or invented number.
//
// ISOLATION CONTRACT: both live rooms re-render every second (auction /
// countdown ticks), and a popular show can see joins every few seconds. This
// hook therefore holds the count as its CALLER's state — mount it inside a
// small memo'd pill component (the way LiveChat isolates messages), never in
// the room screen itself, so a participant joining re-renders the pill and
// nothing else.
import { RoomEvent, type Room } from 'livekit-client';
import { useEffect, useState } from 'react';

export function useViewerCount(room: Room | null): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!room) {
      // The stage unmounted (show ended, screen blurred) — clear the count.
      // Deferred a tick: the React Compiler rejects a synchronous setState in
      // an effect body as a cascading render (same idiom as viewer-stage).
      const t = setTimeout(() => setCount(null), 0);
      return () => clearTimeout(t);
    }
    const update = () =>
      setCount(room.state === 'connected' ? room.remoteParticipants.size + 1 : null);
    room.on(RoomEvent.Connected, update);
    room.on(RoomEvent.Reconnected, update);
    room.on(RoomEvent.Disconnected, update);
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    // Adopted/shared joins can arrive already connected, so no event may ever
    // fire — seed the count now, deferred a tick for the same compiler rule.
    const t = setTimeout(update, 0);
    return () => {
      clearTimeout(t);
      room.off(RoomEvent.Connected, update);
      room.off(RoomEvent.Reconnected, update);
      room.off(RoomEvent.Disconnected, update);
      room.off(RoomEvent.ParticipantConnected, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
    };
  }, [room]);

  return count;
}
