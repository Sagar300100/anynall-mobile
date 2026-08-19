// Notifications centre — reached from the Profile menu.
//
// REAL half: show reminders. "Remind me" on a scheduled show schedules a
// local device notification (lib/reminders); every upcoming one is listed
// here and can be cancelled. HONEST half: account notifications (orders,
// payments, followers) still need a push backend that doesn't exist — the
// screen says so instead of showing an empty feed that implies one.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { cancelShowReminder, listReminders, type ShowReminder } from '@/lib/reminders';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export default function NotificationsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const [reminders, setReminders] = useState<ShowReminder[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listReminders().then((list) => {
        if (!cancelled) setReminders(list);
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function remove(showId: string) {
    if (busyId) return;
    setBusyId(showId);
    try {
      await cancelShowReminder(showId);
      setReminders((prev) => (prev ? prev.filter((r) => r.showId !== showId) : prev));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Notifications</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="notifications-outline"
          title="Sign in to see notifications"
          body="Order updates and show reminders arrive here once you’re signed in."
          reason="profile"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>SHOW REMINDERS</Text>
          {reminders === null ? (
            <ActivityIndicator color={c.primary} style={styles.loading} />
          ) : reminders.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Ionicons name="alarm-outline" size={26} color={c.textFaint} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>No reminders set</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                Tap “Remind me” on any scheduled show and it appears here — your phone pings you
                ten minutes before it starts.
              </Text>
            </View>
          ) : (
            <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              {reminders.map((r, i) => (
                <View key={r.showId}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                  <View style={styles.row}>
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/show/[id]', params: { id: r.showId } })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${r.title}`}
                      style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.7 }]}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: 'rgba(46,107,255,0.14)' }]}>
                        <Ionicons name="alarm-outline" size={17} color={c.primary} />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                          {r.title}
                        </Text>
                        <Text style={[styles.rowMeta, { color: c.textSecondary }]}>
                          Show {formatWhen(r.showAtIso)} · pings {formatWhen(r.fireAtIso)}
                        </Text>
                      </View>
                    </Pressable>
                    {busyId === r.showId ? (
                      <ActivityIndicator size="small" color={c.textSecondary} />
                    ) : (
                      <Pressable
                        onPress={() => remove(r.showId)}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel reminder for ${r.title}`}
                        hitSlop={8}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                      >
                        <Ionicons name="close-circle-outline" size={20} color={c.textFaint} />
                      </Pressable>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Honest about the other half: no push backend exists yet. */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>ACCOUNT ACTIVITY</Text>
          <View style={[styles.empty, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <Ionicons name="notifications-off-outline" size={24} color={c.textFaint} />
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Order, payment and follower notifications arrive here once server notifications
              launch — reminders above already work today.
            </Text>
          </View>
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

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two, paddingBottom: 90 },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4 },
  loading: { paddingVertical: Spacing.four },

  empty: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19, textAlign: 'center', maxWidth: 300 },

  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minHeight: 58,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  rowIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 14, fontFamily: Fonts.sansMedium },
  rowMeta: { fontSize: 12, fontFamily: Fonts.sans },
});
