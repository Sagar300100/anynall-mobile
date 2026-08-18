// Inbox — real-time conversation list (conversations/ model, same as the web
// Messages page). Tap a row to open the thread; unread counts come from the
// conversation summary doc.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { DisplayText, useBrandColors } from '@/components/ui/form';
import { useAuthStatus } from '@/lib/auth-gate';
import { Fonts, Spacing } from '@/constants/theme';
import { subscribeMyConversations, type ConversationView } from '@/lib/conversations';
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.header}>
        <DisplayText size={28}>Messages</DisplayText>
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
      ) : loaded && convos.length === 0 ? (
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
                  {/* Message request awaiting MY decision. */}
                  {item.status === 'pending' && item.requesterId === item.otherUid && (
                    <View style={[styles.requestBadge, { borderColor: 'rgba(77,184,255,0.4)' }]}>
                      <Text style={[styles.requestBadgeText, { color: c.primary }]}>Request</Text>
                    </View>
                  )}
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
  header: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
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
  requestBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  requestBadgeText: { fontSize: 10, fontFamily: Fonts.sansMedium },
  preview: { fontSize: 13, fontFamily: Fonts.sans, marginTop: 2 },
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
