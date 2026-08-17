// Seller Hub intro — the pre-onboarding screen shown on the Sell tab before
// the nine-step wizard starts (approved reference: hero, "Why sell with us"
// benefit card, "What you'll need" card, blue CTA). One clean page; the
// wizard opens only after the CTA.
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'videocam-outline', title: 'Live selling', body: 'Go live and sell in real time' },
  { icon: 'shield-checkmark-outline', title: 'Seller protection', body: 'Secure payouts and buyer support' },
  { icon: 'clipboard-outline', title: 'Fast onboarding', body: 'Guided steps, progress saved as you go' },
];

// The real onboarding requirements — mirrors what the wizard actually asks for.
const REQUIREMENTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'finger-print-outline', title: 'Identity verification', body: 'Aadhaar via Government of India’s DigiLocker' },
  { icon: 'document-text-outline', title: 'PAN', body: 'Verified against your Aadhaar name' },
  { icon: 'receipt-outline', title: 'GST details', body: 'GSTIN, or a GST-portal enrolment number if you’re unregistered' },
  { icon: 'card-outline', title: 'Bank account', body: 'Verified with a ₹1 deposit — payouts go here' },
];

/** In-app requirements sheet (also links to the full Seller Terms). */
export function RequirementsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.cardBackground, borderColor: c.border, paddingBottom: insets.bottom + Spacing.three },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.border }]} />
        <Text style={[styles.sheetTitle, { color: c.text }]}>Seller requirements</Text>
        {REQUIREMENTS.map((r) => (
          <View key={r.title} style={styles.sheetRow}>
            <Ionicons name={r.icon} size={20} color={c.primary} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.sheetRowTitle, { color: c.text }]}>{r.title}</Text>
              <Text style={[styles.sheetRowBody, { color: c.textSecondary }]}>{r.body}</Text>
            </View>
          </View>
        ))}
        <Pressable
          onPress={() =>
            WebBrowser.openBrowserAsync('https://anynall.com/terms#seller-onboarding').catch(() => {})
          }
          accessibilityRole="link"
          accessibilityLabel="Read the full Seller Terms"
          style={({ pressed }) => [styles.sheetLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.sheetLinkText, { color: c.primary }]}>Read the full Seller Terms</Text>
          <Ionicons name="open-outline" size={14} color={c.primary} />
        </Pressable>
      </View>
    </Modal>
  );
}

export function SellerIntro({
  ctaLabel,
  onStart,
}: {
  /** "Start selling" for fresh accounts, "Continue setup" when progress exists. */
  ctaLabel: string;
  onStart: () => void;
}) {
  const c = useBrandColors();
  const [reqOpen, setReqOpen] = useState(false);

  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, { color: c.primary }]}>BECOME A SELLER</Text>
          <Text style={[styles.h1, { color: c.text }]}>Start selling on Any&All</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Reach buyers through live shows and auctions. Setup takes about 10 minutes, and your
            progress is saved.
          </Text>
        </View>

        {/* ── Why sell with us ─────────────────────────────────────── */}
        <View style={[styles.benefitCard, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <Text style={[styles.benefitHeading, { color: c.text }]}>Why sell with us</Text>
          {BENEFITS.map((b, i) => (
            <View key={b.title}>
              {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
              <View style={styles.benefitRow}>
                <View style={[styles.benefitIcon, { backgroundColor: 'rgba(74,143,229,0.12)' }]}>
                  <Ionicons name={b.icon} size={22} color={c.primary} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[styles.benefitTitle, { color: c.text }]}>{b.title}</Text>
                  <Text numberOfLines={2} style={[styles.benefitBody, { color: c.textSecondary }]}>
                    {b.body}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* ── What you'll need — opens the requirements sheet ──────── */}
        <Pressable
          onPress={() => setReqOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="What you'll need — view seller requirements"
          style={({ pressed }) => [
            styles.needCard,
            { backgroundColor: c.cardBackground, borderColor: c.border },
            pressed && { backgroundColor: 'rgba(120,150,210,0.08)' },
          ]}
        >
          <View style={[styles.needIcon, { backgroundColor: 'rgba(74,143,229,0.12)' }]}>
            <Ionicons name="checkmark-done-outline" size={18} color={c.primary} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[styles.needTitle, { color: c.text }]}>What you’ll need</Text>
            <Text style={[styles.needBody, { color: c.textSecondary }]}>
              Identity verification, PAN or tax details, and a bank account for payouts.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
        </Pressable>

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <Pressable
          onPress={onStart}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: Spacing.one }]}
        >
          <LinearGradient
            colors={['#2E6BFF', '#3B82F6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>

        <Pressable
          onPress={() => setReqOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="View seller requirements"
          hitSlop={8}
          style={({ pressed }) => [styles.reqLink, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.reqText, { color: c.primary }]}>View seller requirements</Text>
          <Ionicons name="chevron-forward" size={13} color={c.primary} />
        </Pressable>
      </ScrollView>

      <RequirementsSheet visible={reqOpen} onClose={() => setReqOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  hero: { gap: 7 },
  eyebrow: { fontSize: 12, fontFamily: Fonts.sansSemiBold, letterSpacing: 1.6 },
  h1: { fontSize: 28, fontFamily: Fonts.sansSemiBold, lineHeight: 34 },
  sub: { fontSize: 14.5, fontFamily: Fonts.sans, lineHeight: 21 },

  benefitCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + Spacing.one,
    paddingBottom: Spacing.one,
  },
  benefitHeading: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold, marginBottom: Spacing.one },
  // Inset divider — starts where the text starts, stops short of the edge.
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 56, marginRight: 2 },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 3,
  },
  benefitIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitTitle: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  benefitBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },

  needCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
  },
  needIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  needTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  needBody: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 56,
    borderRadius: 16,
  },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },
  reqLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  reqText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  backdrop: { flex: 1, backgroundColor: 'rgba(2,5,14,0.6)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold, marginTop: Spacing.one },
  sheetRow: { flexDirection: 'row', gap: Spacing.two + Spacing.one, paddingVertical: 7 },
  sheetRowTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  sheetRowBody: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17.5 },
  sheetLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: Spacing.two,
  },
  sheetLinkText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
