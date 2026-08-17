// Is this screen the one the user is actually looking at?
//
// Every route in (app) is registered as a Tabs.Screen, and TAB SCREENS STAY
// MOUNTED. That is harmless for a list, and actively broken for a LiveKit
// room: walking from the buyer's live room to the seller's show room left the
// first screen mounted and still connected, so the app held TWO rooms at once
// and their peer connections fought each other ("Local fingerprint does not
// match identity", "Sender does not belong to this peer connection").
//
// Gate anything that owns a connection, a camera or a socket on this.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * @param assumeFocusedOnMount
 *   TRUE for a screen you PUSH TO (the live room, the show room). useFocusEffect
 *   does not fire until the push animation completes, so starting false meant
 *   the video stage couldn't begin mounting until the screen had finished
 *   sliding in — the buyer watched a blank screen animate in, and only then did
 *   connecting start. Blur still tears the room down.
 *
 *   FALSE (default) for a screen that STAYS MOUNTED BEHIND others — the Live
 *   tab especially. Assuming focus there made the list keep preconnecting a
 *   room for the very show the viewer already had open, and LiveKit allows one
 *   connection per identity, so the two collided with "Local fingerprint does
 *   not match identity". A background screen must never claim to be focused.
 */
export function useScreenFocused(assumeFocusedOnMount = false): boolean {
  const [focused, setFocused] = useState(assumeFocusedOnMount);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Deferred a tick so the state write isn't synchronous inside the
      // callback body — the React Compiler rejects that as a cascading render.
      (async () => {
        await Promise.resolve();
        if (!cancelled) setFocused(true);
      })();
      return () => {
        cancelled = true;
        setFocused(false);
      };
    }, [])
  );

  return focused;
}
