// Help Center — mobile port of the website's pages/HelpCenterPage.tsx.
//
// Same content (src/data/help-faqs.ts, verbatim from the founder's FAQ doc),
// same model: live search scopes the list, category pills scope it further,
// questions expand in place. `nav` tokens inside answers deep-link into the
// in-app legal pages (with the section hash), `mailto` tokens open the mail
// app — an answer is never a dead end.
//
// This replaces the Profile tab's old behaviour of bouncing "Help & support"
// out to anynall.com in a browser.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  HELP_CATEGORIES,
  HELP_FAQS,
  type FaqSegment,
  type HelpCategoryKey,
  type HelpFaq,
} from '@/data/help-faqs';

/** Flatten an answer to plain text for search matching. */
function answerText(a: FaqSegment[]): string {
  return a
    .map((s) => ('t' in s ? s.t : 'label' in s ? s.label : ''))
    .join(' ')
    .toLowerCase();
}

function Answer({ segments }: { segments: FaqSegment[] }) {
  const c = useBrandColors();
  return (
    <Text style={[styles.answer, { color: c.textSecondary }]}>
      {segments.map((s, i) => {
        if ('t' in s) return <Text key={i}>{s.t}</Text>;
        if ('mailto' in s) {
          return (
            <Text
              key={i}
              accessibilityRole="link"
              style={[styles.answerLink, { color: c.primary }]}
              onPress={() => Linking.openURL(`mailto:${s.mailto}`).catch(() => {})}
            >
              {s.mailto}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            accessibilityRole="link"
            style={[styles.answerLink, { color: c.primary }]}
            onPress={() =>
              router.push({
                pathname: `/legal/${s.nav}`,
                params: s.hash ? { section: s.hash } : {},
              } as never)
            }
          >
            {s.label}
          </Text>
        );
      })}
    </Text>
  );
}

export default function HelpCenterScreen() {
  const c = useBrandColors();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HelpCategoryKey | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results = HELP_FAQS.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (!q) return true;
      return f.q.toLowerCase().includes(q) || answerText(f.a).includes(q);
    });
    return HELP_CATEGORIES.map((cat) => ({
      ...cat,
      items: results.filter((f) => f.category === cat.key),
    })).filter((s) => s.items.length > 0);
  }, [query, category]);

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
        <Text style={[styles.topTitle, { color: c.text }]}>Help Center</Text>
        <Pressable
          onPress={() => router.push('/my-tickets')}
          accessibilityRole="button"
          accessibilityLabel="My tickets"
          hitSlop={8}
          style={({ pressed }) => [
            styles.ticketsBtn,
            { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="receipt-outline" size={15} color={c.textSecondary} />
          <Text style={[styles.ticketsBtnText, { color: c.textSecondary }]}>My tickets</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        stickyHeaderIndices={[0]}
      >
        {/* Search + pills stick so the list stays filterable mid-scroll. */}
        <View style={[styles.controls, { backgroundColor: c.background }]}>
          <View
            style={[styles.search, { backgroundColor: c.backgroundElement, borderColor: c.border }]}
          >
            <Ionicons name="search-outline" size={17} color={c.textSecondary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search help articles"
              placeholderTextColor={c.textFaint}
              accessibilityLabel="Search help articles"
              returnKeyType="search"
              style={[styles.searchInput, { color: c.text }]}
            />
            {!!query && (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={17} color={c.textFaint} />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
            keyboardShouldPersistTaps="handled"
          >
            {([{ key: 'all' as const, label: 'All' }, ...HELP_CATEGORIES]).map((cat) => {
              const active = category === cat.key;
              return (
                <Pressable
                  key={cat.key}
                  onPress={() => setCategory(cat.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${cat.label} category`}
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.pill,
                    active
                      ? { backgroundColor: c.cta, borderColor: c.cta }
                      : { borderColor: c.border },
                  ]}
                >
                  <Text
                    style={[styles.pillText, { color: active ? c.ctaText : c.textSecondary }]}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {grouped.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: c.text }]}>No matching articles</Text>
            <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
              Try different words, or raise a ticket and we’ll help directly.
            </Text>
          </View>
        ) : (
          grouped.map((section) => (
            <View key={section.key} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: c.primary }]}>
                {section.label.toUpperCase()}
              </Text>
              <View
                style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}
              >
                {section.items.map((f: HelpFaq, i) => {
                  const open = openId === f.id;
                  return (
                    <View key={f.id}>
                      {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                      <Pressable
                        onPress={() => setOpenId(open ? null : f.id)}
                        accessibilityRole="button"
                        accessibilityLabel={f.q}
                        accessibilityState={{ expanded: open }}
                        style={({ pressed }) => [
                          styles.qRow,
                          pressed && { backgroundColor: 'rgba(120,150,210,0.07)' },
                        ]}
                      >
                        <Text style={[styles.qText, { color: c.text }]}>{f.q}</Text>
                        <Ionicons
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={c.textFaint}
                        />
                      </Pressable>
                      {open && (
                        <View style={styles.aWrap}>
                          <Answer segments={f.a} />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {/* Still stuck → the real escalation paths. */}
        <View
          style={[styles.escalate, { backgroundColor: c.cardBackground, borderColor: c.border }]}
        >
          <Text style={[styles.escalateTitle, { color: c.text }]}>Still need help?</Text>
          <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
            Ask the assistant for an instant answer, or raise a ticket and the team will reply by
            email.
          </Text>
          <View style={styles.escalateRow}>
            <Pressable
              onPress={() => router.push('/support-chat')}
              accessibilityRole="button"
              accessibilityLabel="Ask the assistant"
              style={({ pressed }) => [
                styles.escalateBtn,
                { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Ionicons name="sparkles-outline" size={15} color={c.ctaText} />
              <Text style={[styles.escalateBtnText, { color: c.ctaText }]}>Ask the assistant</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/support-ticket')}
              accessibilityRole="button"
              accessibilityLabel="Raise a ticket"
              style={({ pressed }) => [
                styles.escalateBtn,
                styles.escalateGhost,
                { borderColor: c.borderStrong, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={[styles.escalateBtnText, { color: c.text }]}>Raise a ticket</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => Linking.openURL('mailto:support@anynall.com').catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel="Email support@anynall.com"
            hitSlop={6}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[styles.mailLink, { color: c.primary }]}>support@anynall.com</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  ticketsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 40,
  },
  ticketsBtnText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },

  scroll: { paddingBottom: Spacing.six },
  controls: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15, fontFamily: Fonts.sans },
  pills: { gap: Spacing.two, paddingRight: Spacing.three },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 38,
    justifyContent: 'center',
  },
  pillText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  section: { paddingHorizontal: Spacing.three, marginTop: Spacing.three },
  sectionTitle: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.8,
    marginBottom: Spacing.two,
    marginLeft: 2,
  },
  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  qRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 13,
    minHeight: 50,
  },
  qText: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansMedium, lineHeight: 20 },
  aWrap: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  answer: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 21 },
  answerLink: { fontFamily: Fonts.sansMedium, textDecorationLine: 'underline' },

  empty: { alignItems: 'center', gap: Spacing.one, padding: Spacing.five },
  emptyTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  emptyBody: {
    fontSize: 13.5,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
  },

  escalate: {
    marginHorizontal: Spacing.three,
    marginTop: Spacing.four,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
    gap: Spacing.two,
    alignItems: 'center',
  },
  escalateTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
  escalateRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  escalateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + 2,
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    minHeight: 44,
  },
  escalateGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  escalateBtnText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  mailLink: { fontSize: 13, fontFamily: Fonts.sansMedium, paddingVertical: 6 },
});
