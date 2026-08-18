import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DisplayText,
  Eyebrow,
  PrimaryButton,
  useBrandColors,
} from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import { markShowTapped } from '@/lib/stream';
import { startJoin } from '@/lib/stream-join';
import { useSession } from '@/lib/session';
import { useShows } from '@/hooks/use-shows';

export default function ShowDetailScreen() {
  const c = useBrandColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const { shows, loading } = useShows();
  const show = shows.find((s) => String(s.id) === String(id));
  const [messaging, setMessaging] = useState(false);
  const [messageErr, setMessageErr] = useState<string | null>(null);

  const canMessageSeller = !!show?.ownerUid && show.ownerUid !== user?.uid;

  async function messageSeller() {
    if (!show?.ownerUid || messaging) return;
    setMessaging(true);
    setMessageErr(null);
    try {
      const conversationId = await getOrCreateDirectConversation(show.ownerUid, {
        displayName: show.seller,
        username: show.seller,
      });
      router.push({
        pathname: '/chat/[id]',
        params: { id: conversationId, otherUid: show.ownerUid, otherName: show.seller },
      });
    } catch (err: any) {
      setMessageErr(err?.message || 'Could not open the conversation.');
    } finally {
      setMessaging(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </SafeAreaView>
    );
  }

  if (!show) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: c.background }]}>
        <DisplayText size={26}>Show not found.</DisplayText>
        <PrimaryButton title="Go back" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  const when = show.isLive
    ? 'Live right now'
    : show.scheduled_time
      ? new Date(show.scheduled_time).toLocaleString([], {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Schedule to be announced';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          {show.thumbnail ? (
            <Image source={{ uri: show.thumbnail }} style={styles.hero} contentFit="cover" />
          ) : (
            <View style={[styles.hero, { backgroundColor: c.backgroundSelected }]} />
          )}
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: 'rgba(5,10,24,0.65)' }]}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </Pressable>
          {show.isLive && (
            <View style={[styles.liveBadge, { backgroundColor: c.live }]}>
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          )}
        </View>

        <View style={styles.body}>
          <Eyebrow>{`${show.category}${show.subcategory ? ` · ${show.subcategory}` : ''}`}</Eyebrow>
          <DisplayText size={30}>{show.name}</DisplayText>

          <View style={styles.sellerRow}>
            <Pressable
              onPress={() =>
                show.ownerUid &&
                router.push({
                  pathname: '/user/[username]',
                  params: { username: show.seller, uid: show.ownerUid },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`View @${show.seller}'s profile`}
              hitSlop={6}
              style={({ pressed }) => [styles.sellerLink, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="person-circle-outline" size={22} color={c.primary} />
              <Text style={[styles.seller, { color: c.text }]}>@{show.seller}</Text>
            </Pressable>
            {canMessageSeller && (
              <Pressable
                onPress={messageSeller}
                disabled={messaging}
                hitSlop={6}
                style={[styles.msgBtn, { borderColor: c.borderStrong, opacity: messaging ? 0.6 : 1 }]}
              >
                <Ionicons name="chatbubble-outline" size={13} color={c.primary} />
                <Text style={[styles.msgBtnText, { color: c.text }]}>Message</Text>
              </Pressable>
            )}
            {show.sellerRating !== null && (
              <>
                <Ionicons name="star" size={13} color={c.primary} style={{ marginLeft: 'auto' }} />
                <Text style={[styles.rating, { color: c.textSecondary }]}>
                  {show.sellerRating.toFixed(1)}
                </Text>
              </>
            )}
          </View>
          {!!messageErr && (
            <Text style={{ color: c.danger, fontSize: 12, fontFamily: Fonts.sans }}>
              {messageErr}
            </Text>
          )}

          <View
            style={[styles.infoCard, { backgroundColor: c.cardBackground, borderColor: c.border }]}
          >
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: c.textSecondary }]}>WHEN</Text>
              <Text style={[styles.infoValue, { color: show.isLive ? c.live : c.text }]}>
                {when}
              </Text>
            </View>
            <View style={[styles.hairline, { backgroundColor: c.border }]} />
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: c.textSecondary }]}>FORMAT</Text>
              <Text style={[styles.infoValue, { color: c.text }]}>{show.sellingFormat}</Text>
            </View>
            {show.shippedFrom !== 'N/A' && (
              <>
                <View style={[styles.hairline, { backgroundColor: c.border }]} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: c.textSecondary }]}>SHIPS FROM</Text>
                  <Text style={[styles.infoValue, { color: c.text }]}>{show.shippedFrom}</Text>
                </View>
              </>
            )}
          </View>

          {show.tags.length > 0 && (
            <View style={styles.tagRow}>
              {show.tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: c.border }]}>
                  <Text style={[styles.tagText, { color: c.textSecondary }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {show.isLive ? (
            <PrimaryButton
              title="Join live show"
              onPress={() => {
                // The whole join starts at the tap and overlaps the
                // transition; the room screen adopts it mid-flight.
                markShowTapped(String(show.id));
                startJoin(String(show.id));
                router.push({ pathname: '/live/[id]', params: { id: String(show.id) } });
              }}
            />
          ) : show.replayUrl ? (
            <PrimaryButton
              title="Watch replay"
              onPress={() => WebBrowser.openBrowserAsync(show.replayUrl!)}
            />
          ) : (
            <PrimaryButton
              title="Remind me"
              variant="ghost"
              onPress={() => {
                /* Wired to push notifications once the dev build lands. */
              }}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  scroll: { paddingBottom: Spacing.five },
  heroWrap: { aspectRatio: 4 / 3 },
  hero: { width: '100%', height: '100%' },
  backBtn: {
    position: 'absolute',
    top: Spacing.two,
    left: Spacing.two,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveBadge: {
    position: 'absolute',
    bottom: Spacing.three,
    left: Spacing.three,
    borderRadius: 6,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
  },
  liveText: { color: '#fff', fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5 },
  body: { padding: Spacing.three, gap: Spacing.three },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sellerLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  seller: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  msgBtnText: { fontSize: 12, fontFamily: Fonts.sansMedium },
  rating: { fontSize: 13, fontFamily: Fonts.mono, marginLeft: 4 },
  infoCard: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5 },
  infoValue: { fontFamily: Fonts.sansMedium, fontSize: 14 },
  hairline: { height: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, fontFamily: Fonts.sans },
});
