// Shows — the seller's own show manager. Replaces the Seller Tools "Shows"
// stub with the real thing: every live and upcoming show, with Enter room,
// Edit, and Cancel. All of it runs on operations the app already trusts —
// the seller's Firestore-owned shows with owner-only edit/delete rules.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import type { ShowData } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';
import { deleteShow, fetchMyUpcomingShows } from '@/lib/shows';

function whenLabel(s: ShowData): string {
  if (s.isLive) return 'LIVE now';
  if (!s.scheduled_time) return 'Not scheduled';
  const d = new Date(s.scheduled_time);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${time}`;
}

export default function SellerShowsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const [shows, setShows] = useState<ShowData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setShows(await fetchMyUpcomingShows());
      setError(null);
    } catch {
      setError('Couldn’t load your shows. Check your connection and try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [status, load])
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmCancel(show: ShowData) {
    Alert.alert(
      'Cancel this show?',
      `“${show.name}” will be removed from every buyer’s feed. This can’t be undone.`,
      [
        { text: 'Keep show', style: 'cancel' },
        {
          text: 'Cancel show',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(String(show.id));
            try {
              await deleteShow(String(show.id));
              setShows((prev) => (prev ? prev.filter((s) => String(s.id) !== String(show.id)) : prev));
            } catch {
              Alert.alert('Couldn’t cancel the show', 'Please try again.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seller-tools'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Your shows</Text>
        <Pressable
          onPress={() => router.push('/show-new')}
          accessibilityRole="button"
          accessibilityLabel="Schedule a new show"
          hitSlop={8}
          style={({ pressed }) => [
            styles.newBtn,
            { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="add" size={16} color={c.ctaText} />
          <Text style={[styles.newBtnText, { color: c.ctaText }]}>New</Text>
        </Pressable>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="videocam-outline"
          title="Sign in to manage your shows"
          body="Your live and scheduled shows live here."
          reason="sell"
        />
      ) : shows === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
          }
        >
          {!!error && <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>}

          {shows !== null && shows.length === 0 && !error && (
            <View style={[styles.empty, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Ionicons name="videocam-outline" size={30} color={c.textFaint} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>No upcoming shows</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                Schedule a show and it appears here — and in every buyer’s feed.
              </Text>
            </View>
          )}

          {(shows || []).map((s) => (
            <View
              key={String(s.id)}
              style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}
            >
              <View style={styles.cardTop}>
                {s.thumbnail ? (
                  <Image source={{ uri: s.thumbnail }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty, { borderColor: c.border }]}>
                    <Ionicons name="image-outline" size={18} color={c.textFaint} />
                  </View>
                )}
                <View style={styles.cardText}>
                  <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={2}>
                    {s.name}
                  </Text>
                  <Text
                    style={[
                      styles.cardMeta,
                      { color: s.isLive ? '#E63946' : c.textSecondary },
                      s.isLive && { fontFamily: Fonts.sansSemiBold },
                    ]}
                  >
                    {whenLabel(s)}
                    {s.category ? `  ·  ${s.category}` : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/show-room/[id]', params: { id: String(s.id) } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={s.isLive ? 'Enter your live room' : 'Open the show room'}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Text style={[styles.actionText, { color: c.ctaText }]}>
                    {s.isLive ? 'Enter live room' : 'Open show room'}
                  </Text>
                </Pressable>
                {!s.isLive && (
                  <>
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/show-new', params: { id: String(s.id) } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Edit show"
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionGhost,
                        { borderColor: c.borderStrong, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Text style={[styles.actionText, { color: c.text }]}>Edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => confirmCancel(s)}
                      disabled={deletingId === String(s.id)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel show"
                      style={({ pressed }) => [
                        styles.actionBtn,
                        styles.actionGhost,
                        { borderColor: 'rgba(229,72,77,0.4)', opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      {deletingId === String(s.id) ? (
                        <ActivityIndicator size="small" color={c.danger} />
                      ) : (
                        <Text style={[styles.actionText, { color: c.danger }]}>Cancel</Text>
                      )}
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 13,
    minHeight: 36,
  },
  newBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two, paddingBottom: 90 },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  empty: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center', maxWidth: 300 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two + Spacing.one },
  cardTop: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  thumb: { width: 64, height: 64, borderRadius: 12 },
  thumbEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, gap: 3, justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold, lineHeight: 20 },
  cardMeta: { fontSize: 12.5, fontFamily: Fonts.sans },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actionBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  actionText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
});
