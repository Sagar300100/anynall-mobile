// Tips — replaces the Seller Tools stub with real, useful selling guidance.
// Pure content (no backend needed, nothing faked): the practices that
// actually move live-commerce numbers, grouped the way a seller preps —
// before the show, during, and after. The AI Show Helper handles the
// interactive version of this in the broadcast studio.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const SECTIONS: { title: string; icon: string; tips: { t: string; body: string }[] }[] = [
  {
    title: 'Before the show',
    icon: 'calendar-outline',
    tips: [
      { t: 'Schedule 2–3 days ahead', body: 'Buyers set reminders from your show page — a show announced an hour before starts to an empty room.' },
      { t: 'Thumbnail = your best product', body: 'A clear photo of the single most desirable item outperforms collages and text-heavy graphics.' },
      { t: 'List products before going live', body: 'Attach your lots in Inventory first, so mid-show you tap to start an auction instead of typing details on camera.' },
      { t: 'Promote with real captions', body: 'Promote Tools writes Instagram, X and WhatsApp captions from your actual show details — post them the day before and an hour before.' },
    ],
  },
  {
    title: 'During the show',
    icon: 'radio-outline',
    tips: [
      { t: 'Start on time, greet by name', body: 'The first two minutes decide whether early viewers stay. Say hello to arrivals in chat — named viewers bid more.' },
      { t: 'Short auctions, steady rhythm', body: '30–60 second lots keep energy up. Long gaps between lots are where rooms empty out.' },
      { t: 'Show the item, not the phone', body: 'Fill the frame with the product; describe condition honestly, flaws first. Trust converts better than hype.' },
      { t: 'Repeat what things cost', body: 'New viewers join mid-stream constantly. Re-announce the current lot, price and shipping every minute or two.' },
      { t: 'Use the Show Helper', body: 'The AI helper in your show room suggests openers, pacing and what to do when chat goes quiet.' },
    ],
  },
  {
    title: 'After the show',
    icon: 'cube-outline',
    tips: [
      { t: 'Ship within 24 hours', body: 'Book the courier from Orders & Shipments the same day — fast dispatch is the #1 driver of repeat buyers.' },
      { t: 'Message your winners', body: 'A one-line thank-you with the AWB number turns a buyer into a follower.' },
      { t: 'Schedule the next show before you log off', body: 'Momentum compounds: buyers who just watched are the likeliest to set a reminder for the next one.' },
    ],
  },
];

export default function SellerTipsScreen() {
  const c = useBrandColors();
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
        <Text style={[styles.topTitle, { color: c.text }]}>Tips</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: c.textSecondary }]}>
          What actually moves the numbers in live selling — from sellers who do this well.
        </Text>

        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Ionicons name={section.icon as never} size={15} color={c.primary} />
              <Text style={[styles.sectionTitle, { color: c.primary }]}>
                {section.title.toUpperCase()}
              </Text>
            </View>
            <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              {section.tips.map((tip, i) => (
                <View key={tip.t}>
                  {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                  <View style={styles.tipRow}>
                    <Text style={[styles.tipTitle, { color: c.text }]}>{tip.t}</Text>
                    <Text style={[styles.tipBody, { color: c.textSecondary }]}>{tip.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
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

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.three, paddingBottom: 90 },
  intro: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20 },

  section: { gap: Spacing.two },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginLeft: 2 },
  sectionTitle: { fontFamily: Fonts.mono, fontSize: 10.5, letterSpacing: 1.8 },
  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  tipRow: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one, gap: 3 },
  tipTitle: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  tipBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
});
