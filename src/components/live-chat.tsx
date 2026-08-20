// Live-room chat column — self-contained so a message flood re-renders THIS
// component and nothing else. It owns the Firestore subscription and the
// messages state; the parent screen (live/[id]) holds no messages at all, so
// a busy chat can no longer re-render the header, rail, auction panel or
// video overlays on every snapshot.
//
// Flood control, in order of importance:
//   • ~250ms snapshot buffer — snapshots park in a ref; an interval flushes
//     to state only when something new arrived, so a burst of N messages
//     costs ONE render, not N.
//   • INVERTED FlatList — data is newest-first and the list is anchored at
//     the visual bottom, so a new message needs no scrollToEnd (the old list
//     ran an animated scrollToEnd on EVERY content-size change). A reader
//     who has scrolled up into history is no longer yanked back down.
//   • Doc-id keys + memo'd rows + object reuse across flushes — rows that
//     were already on screen keep their identity and skip re-rendering; only
//     genuinely new rows do any work. Index keys re-rendered the whole list
//     per message.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { User } from 'firebase/auth';
import { memo, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';
import { useAuthGate } from '@/lib/auth-gate';
import { subscribeMessages, type ChatDoc } from '@/lib/chat';

/** How long an arriving snapshot may sit in the ref before it must paint —
 *  long enough to fold a flood into one render, short enough that your own
 *  message still feels instant. */
const FLUSH_MS = 250;

/** One message. Memo'd on item identity: the flush below reuses the previous
 *  object for any doc id it already held, and chat docs are immutable once
 *  written, so identity equality is content equality for everything rendered
 *  here. */
const ChatRow = memo(function ChatRow({ item }: { item: ChatDoc }) {
  return (
    <View style={styles.msgRow}>
      <View style={styles.msgAvatar}>
        <Text style={styles.msgAvatarText}>
          {(item.avatar || item.user).slice(0, 1).toLowerCase()}
        </Text>
      </View>
      <View style={styles.msgBody}>
        <Text style={styles.msgUser} numberOfLines={1}>
          {item.user}
        </Text>
        <Text style={styles.msgText}>{item.text}</Text>
      </View>
    </View>
  );
});

// Module scope so the FlatList never sees a new renderItem/keyExtractor
// identity — the list must not re-render its rows because the column did.
const keyExtractor = (m: ChatDoc) => m.id;
const renderRow = ({ item }: ListRenderItemInfo<ChatDoc>) => <ChatRow item={item} />;

export const LiveChat = memo(function LiveChat({
  showId,
  user,
  hidden,
  onNotice,
}: {
  showId: string;
  /** Session user. Chat reads are signed-in only (firestore.rules) — for a
   *  guest the listener died with permission-denied and the room showed an
   *  empty chat that read as broken. Guests get the sign-in pill instead,
   *  and no doomed listener is opened at all. */
  user: User | null;
  /** More → Hide chat. Rendering only — the messages keep streaming
   *  underneath, exactly as before, so un-hiding is instant and complete. */
  hidden: boolean;
  /** Transient room banner (the parent's `notice` state). MUST be
   *  referentially stable — pass the setState function itself; this
   *  component is memo'd and subscribes on its identity. */
  onNotice: (message: string) => void;
}) {
  const requireAuth = useAuthGate();
  const [messages, setMessages] = useState<ChatDoc[]>([]);
  // The newest snapshot, parked until the next flush. null = nothing new
  // arrived since the last flush, so the interval touches no state at all.
  const pending = useRef<ChatDoc[] | null>(null);

  useEffect(() => {
    if (!showId || !user) return;
    // A resubscribe (show or user changed) must never flush the PREVIOUS
    // subscription's parked snapshot into the new one's list.
    pending.current = null;
    const unsubscribe = subscribeMessages(
      showId,
      (docs) => {
        // Park, don't paint: under a flood every message is its own snapshot,
        // and a setState per snapshot renders the whole column per message.
        pending.current = docs;
      },
      () =>
        // Signed-in and the listener still died (rules change, outage) — say
        // so once rather than leaving a silently dead column.
        onNotice('Chat is unavailable right now.')
    );
    const flush = setInterval(() => {
      const fresh = pending.current;
      if (fresh === null) return;
      pending.current = null;
      // Reversed to newest-first for the inverted list, reusing the object a
      // previous flush already delivered for the same doc id — that identity
      // is what lets ChatRow's memo (and the FlatList cell) skip entirely.
      setMessages((prev) => {
        const held = new Map(prev.map((m) => [m.id, m]));
        const next: ChatDoc[] = [];
        for (let i = fresh.length - 1; i >= 0; i -= 1) {
          const m = fresh[i];
          next.push(held.get(m.id) ?? m);
        }
        return next;
      });
    }, FLUSH_MS);
    return () => {
      unsubscribe();
      clearInterval(flush);
    };
  }, [showId, user, onNotice]);

  if (hidden) return null;

  if (!user) {
    return (
      <Pressable
        onPress={() => requireAuth('chat', () => {})}
        accessibilityRole="button"
        accessibilityLabel="Sign in to join the chat"
        style={({ pressed }) => [styles.chatSignIn, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FFFFFF" />
        <Text style={styles.chatSignInText}>Sign in to watch and join the chat</Text>
      </Pressable>
    );
  }

  return (
    <FlatList
      data={messages}
      inverted
      keyExtractor={keyExtractor}
      style={styles.chatList}
      contentContainerStyle={styles.chatContent}
      showsVerticalScrollIndicator={false}
      renderItem={renderRow}
    />
  );
});

/** Anything floating on live video needs its own contrast — the frame behind
 *  it changes every second, so a colour that works now can vanish next shot. */
const SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
} as const;

const styles = StyleSheet.create({
  chatList: { maxHeight: 260, flexGrow: 0 },
  // Inverted list: the container is flipped vertically, so the visual bottom
  // gap the old list drew with paddingBottom is paddingTop here.
  chatContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.two + Spacing.one,
  },
  msgRow: { flexDirection: 'row', gap: Spacing.two + 2, alignItems: 'flex-start' },
  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(24,36,64,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  msgBody: { flex: 1, gap: 1 },
  // Chat floats over live video, so it carries its own shadow rather than a
  // panel — a solid backdrop would hide the item the seller is showing.
  msgUser: { fontSize: 14, fontFamily: Fonts.sansSemiBold, color: 'rgba(214,224,242,0.9)', ...SHADOW },
  msgText: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold, lineHeight: 20, color: '#FFFFFF', ...SHADOW },

  // ── Guest chat prompt ─────────────────────────────────────────────────
  chatSignIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    marginLeft: Spacing.three,
    marginBottom: Spacing.two,
    backgroundColor: 'rgba(18,26,44,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  chatSignInText: { color: '#FFFFFF', fontSize: 13, fontFamily: Fonts.sansSemiBold },
});
