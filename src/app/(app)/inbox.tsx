// Inbox — real-time conversation list (conversations/ model, same as the web
// Messages page). Tap a row to open the thread; unread counts come from the
// conversation summary doc. Incoming FOLLOW REQUESTS (private-account model,
// web Messages "Requests" tab) sit above the conversations — fetched on
// focus, no realtime listener needed.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { DisplayText, useBrandColors } from '@/components/ui/form';
import { useAuthStatus } from '@/lib/auth-gate';
import { Brand, CtaGradientShell, Fonts, Spacing } from '@/constants/theme';
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
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <FadeUp index={0} style={styles.header}>
          <View style={styles.headerTitle}>
            <Eyebrow>Inbox</Eyebrow>
            <DisplayText size={28}>Messages</DisplayText>
          </View>
          <View style={styles.headerSpacer} />
          {/* People search — find someone to message (audit: the app had no way
              to find a person; profiles were only reachable from shows/chats). */}
          <PressScale
            onPress={() => router.push('/people-search')}
            accessibilityRole="button"
            accessibilityLabel="Find people"
            hitSlop={8}
            style={styles.searchBtn}
          >
            <Ionicons name="search-outline" size={18} color={Brand.slate400} />
          </PressScale>
        </FadeUp>

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
            <Ionicons name="cloud-offline-outline" size={44} color={Brand.slate400} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>Couldn’t load messages</Text>
            <Text style={[styles.emptyText, { color: Brand.slate400 }]}>{error}</Text>
          </View>
        ) : loaded && convos.length === 0 && requests.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="chatbubble-ellipses-outline" size={44} color={Brand.blueSky} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>No conversations yet</Text>
            <Text style={[styles.emptyText, { color: Brand.slate400 }]}>
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
                  <Eyebrow style={styles.requestsLabel}>
                    {`Follow requests (${requests.length})`}
                  </Eyebrow>
                  {requests.map((p) => (
                    <View key={p.uid} style={[styles.row, { borderColor: Brand.hairlineWhite }]}>
                      <PressScale
                        onPress={() =>
                          router.push({
                            pathname: '/user/[username]',
                            params: { username: p.username || p.uid, uid: p.uid },
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`View ${p.name}'s profile`}
                        style={styles.requestPerson}
                      >
                        {p.photoURL ? (
                          <Image
                            source={{ uri: p.photoURL }}
                            style={styles.requestAvatar}
                            contentFit="cover"
                          />
                        ) : (
                          <View
                            style={[styles.requestAvatar, { backgroundColor: Brand.ink600 }]}
                          >
                            <Text style={[styles.avatarText, { color: Brand.blueSky }]}>
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
                              style={[styles.requestHandle, { color: Brand.mistFaint }]}
                            >
                              @{p.username}
                            </Text>
                          )}
                        </View>
                      </PressScale>
                      <PressScale
                        onPress={() => handleAccept(p)}
                        disabled={requestBusy !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Accept follow request from ${p.name}`}
                        accessibilityState={{ disabled: requestBusy !== null }}
                        style={[styles.requestBtn, requestBusy === p.uid && { opacity: 0.7 }]}
                      >
                        <LinearGradient
                          colors={[...CtaGradientShell]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.requestBtnFill}
                        >
                          {requestBusy === p.uid ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={[styles.requestBtnText, { color: '#FFFFFF' }]}>Accept</Text>
                          )}
                        </LinearGradient>
                      </PressScale>
                      <PressScale
                        onPress={() => handleDecline(p)}
                        disabled={requestBusy !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Decline follow request from ${p.name}`}
                        accessibilityState={{ disabled: requestBusy !== null }}
                        style={[
                          styles.requestBtn,
                          styles.requestBtnGhost,
                          requestBusy === p.uid && { opacity: 0.7 },
                        ]}
                      >
                        <Text style={[styles.requestBtnText, { color: c.text }]}>Decline</Text>
                      </PressScale>
                    </View>
                  ))}
                </View>
              )
            }
            renderItem={({ item }) => (
              <PressScale
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
                accessibilityRole="button"
                accessibilityLabel={`Open conversation with ${item.otherName}`}
                style={[styles.row, { borderColor: Brand.hairlineWhite }]}
              >
                {item.otherPhoto ? (
                  <Image source={{ uri: item.otherPhoto }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: Brand.ink600 }]}>
                    <Text style={[styles.avatarText, { color: Brand.blueSky }]}>
                      {item.otherName.slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
                      {item.otherName}
                    </Text>
                    <Text style={[styles.time, { color: Brand.mistFaint }]}>
                      {timeAgo(item.lastMessageAt)}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.preview,
                      { color: item.unread > 0 ? c.text : Brand.slate400 },
                      item.unread > 0 && { fontFamily: Fonts.uiSemiBold },
                    ]}
                  >
                    {item.lastMessageText || 'Say hello 👋'}
                  </Text>
                </View>
                {item.unread > 0 && (
                  <View style={[styles.badge, { backgroundColor: Brand.blueSky }]}>
                    <Text style={styles.badgeText}>{item.unread > 9 ? '9+' : item.unread}</Text>
                  </View>
                )}
              </PressScale>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerTitle: { gap: Spacing.one },
  headerSpacer: { flex: 1 },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
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
  emptyTitle: { fontSize: 20, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  emptyText: { fontSize: 14, fontFamily: Fonts.ui, textAlign: 'center', lineHeight: 20 },
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
  name: { flex: 1, fontSize: 15, fontFamily: Fonts.uiSemiBold },
  time: { fontSize: 11, fontFamily: Fonts.mono },
  preview: { fontSize: 13, fontFamily: Fonts.ui, marginTop: 2 },
  requestsLabel: {
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
  requestHandle: { fontSize: 12, fontFamily: Fonts.ui, marginTop: 1 },
  requestBtn: {
    borderRadius: 999,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  requestBtnFill: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestBtnGhost: {
    borderWidth: 1,
    borderColor: Brand.hairline,
    paddingHorizontal: 14,
  },
  requestBtnText: { fontSize: 13, fontFamily: Fonts.uiBold },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#04122B', fontSize: 11, fontFamily: Fonts.uiBold },
});
