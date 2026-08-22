import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { GlassCard } from '@/components/brand/glass-card';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { LivePulseDot } from '@/components/brand/live-pulse-dot';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { DisplayText, useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { getOrCreateDirectConversation } from '@/lib/conversations';
import { cancelShowReminder, isReminderSet, scheduleShowReminder } from '@/lib/reminders';
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
  // Real local reminder state — re-checked on focus so the button never lies.
  const [reminded, setReminded] = useState(false);
  const [remindBusy, setRemindBusy] = useState(false);

  const showIdForReminder = show ? String(show.id) : null;
  useFocusEffect(
    useCallback(() => {
      if (!showIdForReminder) return;
      let cancelled = false;
      isReminderSet(showIdForReminder).then((v) => {
        if (!cancelled) setReminded(v);
      });
      return () => {
        cancelled = true;
      };
    }, [showIdForReminder])
  );

  async function toggleReminder() {
    if (!show || remindBusy) return;
    setRemindBusy(true);
    try {
      if (reminded) {
        await cancelShowReminder(String(show.id));
        setReminded(false);
      } else {
        await scheduleShowReminder({
          showId: String(show.id),
          title: show.name,
          scheduledTimeIso: show.scheduled_time || '',
        });
        setReminded(true);
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'PERMISSION_DENIED') {
        Alert.alert(
          'Notifications are off',
          'Allow notifications for Any&All in system settings to get show reminders.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
      } else if (code === 'TOO_LATE') {
        Alert.alert('Starting too soon', 'This show starts in the next few minutes — jump in from Live instead.');
      } else if (code === 'BAD_TIME') {
        Alert.alert('No start time yet', 'This show hasn’t been given a start time, so there’s nothing to remind you about.');
      } else {
        Alert.alert('Couldn’t set the reminder', 'Please try again.');
      }
    } finally {
      setRemindBusy(false);
    }
  }

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
      <View style={styles.root}>
        <PageAtmosphere />
        <SafeAreaView style={[styles.safe, styles.center]}>
          <ActivityIndicator size="large" color={Brand.blueSky} />
        </SafeAreaView>
      </View>
    );
  }

  if (!show) {
    return (
      <View style={styles.root}>
        <PageAtmosphere />
        <SafeAreaView style={[styles.safe, styles.center]}>
          <DisplayText size={26}>Show not found.</DisplayText>
          <PressScale
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.ghostBtn}
          >
            <Text style={styles.ghostBtnText}>Go back</Text>
          </PressScale>
        </SafeAreaView>
      </View>
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
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.heroWrap}>
            {show.thumbnail ? (
              <Image source={{ uri: show.thumbnail }} style={styles.hero} contentFit="cover" />
            ) : (
              <View style={[styles.hero, { backgroundColor: Brand.ink600 }]} />
            )}
            <PressScale
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={[styles.backBtn, { backgroundColor: 'rgba(2,8,20,0.65)' }]}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={22} color={c.text} />
            </PressScale>
            {show.isLive && (
              <View style={[styles.liveBadge, { backgroundColor: Brand.live }]}>
                <LivePulseDot color="#FFFFFF" size={6} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>

          <View style={styles.body}>
            <FadeUp index={0} style={styles.titleBlock}>
              <Eyebrow>{`${show.category}${show.subcategory ? ` · ${show.subcategory}` : ''}`}</Eyebrow>
              <DisplayText size={30}>{show.name}</DisplayText>
            </FadeUp>

            <FadeUp index={1} style={styles.midBlock}>
              <View style={styles.sellerRow}>
                <PressScale
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
                  style={styles.sellerLink}
                >
                  <Ionicons name="person-circle-outline" size={22} color={Brand.blueSky} />
                  <Text style={[styles.seller, { color: c.text }]}>@{show.seller}</Text>
                </PressScale>
                {canMessageSeller && (
                  <PressScale
                    onPress={messageSeller}
                    disabled={messaging}
                    accessibilityRole="button"
                    accessibilityLabel={`Message @${show.seller}`}
                    hitSlop={6}
                    style={[styles.msgBtn, { opacity: messaging ? 0.6 : 1 }]}
                  >
                    <Ionicons name="chatbubble-outline" size={13} color={Brand.blueSky} />
                    <Text style={[styles.msgBtnText, { color: c.text }]}>Message</Text>
                  </PressScale>
                )}
                {show.sellerRating !== null && (
                  <>
                    <Ionicons name="star" size={13} color={Brand.blueSky} style={{ marginLeft: 'auto' }} />
                    <Text style={[styles.rating, { color: Brand.slate400 }]}>
                      {show.sellerRating.toFixed(1)}
                    </Text>
                  </>
                )}
              </View>
              {!!messageErr && (
                <Text style={{ color: Brand.dangerSoft, fontSize: 12, fontFamily: Fonts.ui }}>
                  {messageErr}
                </Text>
              )}

              <GlassCard style={styles.infoCard}>
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: Brand.slate400 }]}>WHEN</Text>
                  <View style={styles.infoValueRow}>
                    {show.isLive && <LivePulseDot color={Brand.live} size={7} />}
                    <Text style={[styles.infoValue, { color: show.isLive ? Brand.live : c.text }]}>
                      {when}
                    </Text>
                  </View>
                </View>
                <View style={[styles.hairline, { backgroundColor: Brand.hairlineWhite }]} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: Brand.slate400 }]}>FORMAT</Text>
                  <Text style={[styles.infoValue, { color: c.text }]}>{show.sellingFormat}</Text>
                </View>
                {show.shippedFrom !== 'N/A' && (
                  <>
                    <View style={[styles.hairline, { backgroundColor: Brand.hairlineWhite }]} />
                    <View style={styles.infoRow}>
                      <Text style={[styles.infoLabel, { color: Brand.slate400 }]}>SHIPS FROM</Text>
                      <Text style={[styles.infoValue, { color: c.text }]}>{show.shippedFrom}</Text>
                    </View>
                  </>
                )}
              </GlassCard>

              {show.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {show.tags.map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={[styles.tagText, { color: Brand.slate400 }]}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </FadeUp>

            <FadeUp index={2}>
              {show.isLive ? (
                <GradientCTA
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
                <GradientCTA
                  title="Watch replay"
                  onPress={() =>
                    router.push({
                      pathname: '/replay',
                      params: { url: show.replayUrl!, title: show.name },
                    })
                  }
                />
              ) : (
                // REAL local reminder — a scheduled device notification ~10 min
                // before the show. Device-local by design: no push backend exists.
                <PressScale
                  onPress={toggleReminder}
                  disabled={remindBusy}
                  accessibilityRole="button"
                  accessibilityLabel={reminded ? 'Cancel reminder' : 'Remind me'}
                  accessibilityState={{ disabled: remindBusy }}
                  style={styles.ghostBtn}
                >
                  {remindBusy ? (
                    <ActivityIndicator size="small" color={c.text} />
                  ) : (
                    <Text style={styles.ghostBtnText}>
                      {reminded ? 'Reminder set ✓ · tap to cancel' : 'Remind me'}
                    </Text>
                  )}
                </PressScale>
              )}
            </FadeUp>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 6,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 3,
  },
  liveText: { color: '#fff', fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5 },
  body: { padding: Spacing.three, gap: Spacing.three },
  titleBlock: { gap: Spacing.three },
  midBlock: { gap: Spacing.three },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sellerLink: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  seller: { fontSize: 15, fontFamily: Fonts.uiSemiBold },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: Brand.hairline,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
  },
  msgBtnText: { fontSize: 12, fontFamily: Fonts.uiSemiBold },
  rating: { fontSize: 13, fontFamily: Fonts.mono, marginLeft: 4 },
  infoCard: { padding: Spacing.three, gap: Spacing.two },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5 },
  infoValue: { fontFamily: Fonts.uiSemiBold, fontSize: 14 },
  hairline: { height: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tag: {
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: 4,
  },
  tagText: { fontSize: 12, fontFamily: Fonts.ui },
  ghostBtn: {
    borderWidth: 1,
    borderColor: Brand.hairline,
    borderRadius: 13,
    minHeight: 48,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  ghostBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.uiBold },
});
