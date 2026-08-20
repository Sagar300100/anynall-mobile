// Inbox — real-time conversation list (conversations/ model, same as the web
// Messages page). Tap a row to open the thread; unread counts come from the
// conversation summary doc. Incoming FOLLOW REQUESTS (private-account model,
// web Messages "Requests" tab) sit above the conversations — fetched on
// focus, no realtime listener needed.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { DisplayText, useBrandColors } from '@/components/ui/form';
import { useAuthStatus } from '@/lib/auth-gate';
import { Fonts, Spacing } from '@/constants/theme';
import { subscribeMyConversations, type ConversationView } from '@/lib/conversations';
import {
  acceptFollowRequest,
  declineFollowRequest,
  listIncomingRequests,
  type PersonRef,
} from '@/lib/follows';
import { useSession } from '@/lib/session';

function timeAgo(millis?: number): string {
  if (!millis) return '';
  const s = Math.max(1, Math.floor((Date.now() - millis) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function InboxScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const status = useAuthStatus();
  const [convos, setConvos] = useState<ConversationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Incoming follow requests (private accounts). Refetched on every focus so
  // a request accepted from the profile screen disappears on return; the uid
  // marks which row's Accept/Decline is in flight.
  const [requests, setRequests] = useState<PersonRef[]>([]);
  const [requestBusy, setRequestBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const off = subscribeMyConversations(
      (list) => {
        setConvos(list);
        setLoaded(true);
      },
      (message) => {
        setError(message);
        setLoaded(true);
      }
    );
    return off;
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      listIncomingRequests().then((list) => {
        if (!cancelled) setRequests(list);
      });
      return () => {
        cancelled = true;
      };
    }, [user])
  );

  async function handleAccept(p: PersonRef) {
    if (requestBusy) return;
    setRequestBusy(p.uid);
    try {
      await acceptFollowRequest(p.uid);
      setRequests((r) => r.filter((x) => x.uid !== p.uid));
    } catch {
      Alert.alert('Couldn’t accept the request', 'Please try again in a moment.');
    } finally {
      setRequestBusy(null);
    }
  }

  async function handleDecline(p: PersonRef) {
    if (requestBusy) return;
    setRequestBusy(p.uid);
    try {
      await declineFollowRequest(p.uid);
      setRequests((r) => r.filter((x) => x.uid !== p.uid));
    } catch {
      Alert.alert('Couldn’t decline the request', 'Please try again in a moment.');
    } finally {
      setRequestBusy(null);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.header}>
        <DisplayText size={28}>Messages</DisplayText>
        <View style={styles.headerSpacer} />
        {/* People search — find someone to message (audit: the app had no way
            to find a person; profiles were only reachable from shows/chats). */}
        <Pressable
          onPress={() => router.push('/people-search')}
          accessibilityRole="button"
          accessibilityLabel="Find people"
          hitSlop={8}
          style={({ pressed }) => [
            styles.searchBtn,
            { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="search-outline" size={18} color={c.textSecondary} />
        </Pressable>
      </View>

      {status === 'loading' ? (
        // Session restoring — neither guest copy nor an empty member inbox yet.
        <View style={styles.center} />
      ) : status === 'guest' ? (
        <GuestPrompt
          icon="chatbubble-outline"
          title="Your messages live here"
          body="Once you’re signed in, this is where sellers reach you about the things you’re buying."
          points={[
            'Messages from sellers you’ve bought from',
            'Updates on orders you’ve placed',
            'Reminders for shows you’re waiting on',
          ]}
          reason="inbox"
        />
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={44} color={c.textSecondary} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>Couldn’t load messages</Text>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>{error}</Text>
        </View>
      ) : loaded && convos.length === 0 && requests.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-ellipses-outline" size={44} color={c.primary} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No conversations yet</Text>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            Message a seller from any show page and it’ll appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={convos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            requests.length === 0 ? null : (
              /* Follow requests — the web Messages page's "Requests" tab. */
              <View>
                <Text style={[styles.requestsLabel, { color: c.textSecondary }]}>
                  FOLLOW REQUESTS ({requests.length})
                </Text>
                {requests.map((p) => (
                  <View key={p.uid} style={[styles.row, { borderColor: c.border }]}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/user/[username]',
                          params: { username: p.username || p.uid, uid: p.uid },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.name}'s profile`}
                      style={({ pressed }) => [styles.requestPerson, pressed && { opacity: 0.7 }]}
                    >
                      {p.photoURL ? (
                        <Image
                          source={{ uri: p.photoURL }}
                          style={styles.requestAvatar}
                          contentFit="cover"
                        />
                      ) : (
                        <View
                          style={[styles.requestAvatar, { backgroundColor: c.backgroundSelected }]}
                        >
                          <Text style={[styles.avatarText, { color: c.primary }]}>
                            {p.name.slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
                          {p.name}
                        </Text>
                        {!!p.username && (
                          <Text
                            numberOfLines={1}
                            style={[styles.requestHandle, { color: c.textFaint }]}
                          >
                            @{p.username}
                          </Text>
                        )}
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => handleAccept(p)}
                      disabled={requestBusy !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Accept follow request from ${p.name}`}
                      accessibilityState={{ disabled: requestBusy !== null }}
                      style={({ pressed }) => [
                        styles.requestBtn,
                        { backgroundColor: c.cta },
                        (pressed || requestBusy === p.uid) && { opacity: 0.7 },
                      ]}
                    >
                      {requestBusy === p.uid ? (
                        <ActivityIndicator size="small" color={c.ctaText} />
                      ) : (
                        <Text style={[styles.requestBtnText, { color: c.ctaText }]}>Accept</Text>
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => handleDecline(p)}
                      disabled={requestBusy !== null}
                      accessibilityRole="button"
                      accessibilityLabel={`Decline follow request from ${p.name}`}
                      accessibilityState={{ disabled: requestBusy !== null }}
                      style={({ pressed }) => [
                        styles.requestBtn,
                        { borderWidth: 1, borderColor: c.borderStrong },
                        (pressed || requestBusy === p.uid) && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[styles.requestBtnText, { color: c.text }]}>Decline</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: item.id,
                    otherUid: item.otherUid,
                    otherName: item.otherName,
                  },
                })
              }
              style={({ pressed }) => [
                styles.row,
                { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {item.otherPhoto ? (
                <Image source={{ uri: item.otherPhoto }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, { backgroundColor: c.backgroundSelected }]}>
                  <Text style={[styles.avatarText, { color: c.primary }]}>
                    {item.otherName.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
                    {item.otherName}
                  </Text>
                  <Text style={[styles.time, { color: c.textFaint }]}>
                    {timeAgo(item.lastMessageAt)}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.preview,
                    { color: item.unread > 0 ? c.text : c.textSecondary },
                    item.unread > 0 && { fontFamily: Fonts.sansMedium },
                  ]}
                >
                  {item.lastMessageText || 'Say hello 👋'}
                </Text>
              </View>
              {item.unread > 0 && (
                <View style={[styles.badge, { backgroundColor: c.primary }]}>
                  <Text style={styles.badgeText}>{item.unread > 9 ? '9+' : item.unread}</Text>
                </View>
              )}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerSpacer: { flex: 1 },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  emptyText: { fontSize: 14, fontFamily: Fonts.sans, textAlign: 'center', lineHeight: 20 },
  list: { paddingBottom: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.mono, fontSize: 14 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  name: { flex: 1, fontSize: 15, fontFamily: Fonts.sansSemiBold },
  time: { fontSize: 11, fontFamily: Fonts.mono },
  preview: { fontSize: 13, fontFamily: Fonts.sans, marginTop: 2 },
  requestsLabel: {
    fontSize: 11.5,
    fontFamily: Fonts.sansMedium,
    letterSpacing: 1.1,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
  },
  requestPerson: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  requestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestHandle: { fontSize: 12, fontFamily: Fonts.sans, marginTop: 1 },
  requestBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestBtnText: { fontSize: 13, fontFamily: Fonts.sansSemiBold },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#04102A', fontSize: 11, fontFamily: Fonts.sansSemiBold },
});
