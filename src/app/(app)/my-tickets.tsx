// My Tickets — mobile port of the website's pages/MyTicketsPage.tsx.
//
// The signed-in user's support tickets (assistant escalations + Raise-a-Ticket
// submissions) from GET /api/support/my-escalations. The endpoint is scoped to
// the caller's uid server-side — this screen can never show anyone else's
// tickets. Signed-out users get the standard GuestPrompt, not an error.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
import { useAuthStatus } from '@/lib/auth-gate';
import { CATEGORY_LABEL, listMyTickets, type MyTicket, type TicketCategory } from '@/lib/support';

/** Status → tint. Same reading as the website: green settled, amber waiting
 *  on the user, blue in progress. Never the only signal — the written status
 *  is always shown beside it. */
function statusTone(status: string) {
  const v = status.toLowerCase();
  if (v === 'resolved' || v === 'closed')
    return { color: '#4ade80', bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.35)' };
  if (v.includes('wait'))
    return { color: '#ffd479', bg: 'rgba(255,190,80,0.10)', border: 'rgba(255,190,80,0.30)' };
  return { color: '#4db8ff', bg: 'rgba(30,111,255,0.12)', border: 'rgba(77,184,255,0.35)' };
}

function formatDate(millis: number | null): string {
  if (!millis) return '';
  return new Date(millis).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function MyTicketsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const [tickets, setTickets] = useState<MyTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isCancelled?: () => boolean) => {
    try {
      const rows = await listMyTickets();
      if (isCancelled?.()) return;
      setError(null);
      setTickets(rows);
    } catch {
      if (isCancelled?.()) return;
      setError('Could not load your tickets. Check your connection and try again.');
    }
  }, []);

  // Focus, not mount: coming back from Raise-a-Ticket must show the new one.
  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      load(() => cancelled);
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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/help'))}
          accessibilityRole="button"
          accessibilityLabel="Back to Help Center"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>My Tickets</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="receipt-outline"
          title="Sign in to see your tickets"
          body="Support tickets are tied to your account — sign in to track everything you've raised."
          reason="profile"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.primary} />
          }
        >
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Everything you’ve raised — from the assistant or the ticket form. Replies arrive at
            your registered email.
          </Text>

          {error && (
            <View style={[styles.errorBox, { borderColor: 'rgba(229,72,77,0.25)' }]}>
              <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
            </View>
          )}

          {!error && tickets === null && (
            <View style={styles.loading}>
              <ActivityIndicator color={c.primary} />
            </View>
          )}

          {tickets !== null && tickets.length === 0 && (
            <View style={[styles.empty, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Text style={[styles.emptyTitle, { color: c.text }]}>No tickets yet</Text>
              <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
                If you ever need help, ask the assistant — it answers from our policies and can
                raise a ticket for you when needed.
              </Text>
              <Pressable
                onPress={() => router.push('/support-chat')}
                accessibilityRole="button"
                accessibilityLabel="Ask the assistant"
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <Text style={[styles.emptyBtnText, { color: c.ctaText }]}>Ask the assistant</Text>
              </Pressable>
            </View>
          )}

          {tickets !== null && tickets.length > 0 && (
            <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              {tickets.map((t, i) => {
                const tone = statusTone(t.status || 'open');
                return (
                  <View key={`${t.reference}-${i}`}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={[styles.reference, { color: c.text }]} numberOfLines={1}>
                          {t.reference}
                          {t.subject ? (
                            <Text style={{ color: c.textSecondary, fontFamily: Fonts.sans }}>
                              {'  '}{t.subject}
                            </Text>
                          ) : null}
                        </Text>
                        <Text style={[styles.meta, { color: c.textFaint }]}>
                          {CATEGORY_LABEL[t.category as TicketCategory] || t.category}
                          {t.createdAt ? ` · ${formatDate(t.createdAt)}` : ''}
                          {t.source === 'ai_assistant' ? ' · via assistant' : ''}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.status,
                          { backgroundColor: tone.bg, borderColor: tone.border },
                        ]}
                      >
                        <Text style={[styles.statusText, { color: tone.color }]}>
                          {t.status || 'open'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
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

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.three },
  subtitle: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20 },

  errorBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    backgroundColor: 'rgba(229,72,77,0.08)',
  },
  errorText: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 19 },
  loading: { paddingVertical: Spacing.five, alignItems: 'center' },

  empty: {
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
  emptyBody: {
    fontSize: 13.5,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    minHeight: 44,
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  emptyBtnText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    minHeight: 60,
  },
  rowText: { flex: 1, gap: 2 },
  reference: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  meta: { fontSize: 12, fontFamily: Fonts.sans },
  status: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  statusText: { fontSize: 11.5, fontFamily: Fonts.sansSemiBold, textTransform: 'capitalize' },
});
