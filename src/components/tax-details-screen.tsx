// Tax Details — step 2 of seller onboarding.
//
// PHASE 1: layout, selection and navigation only. The choice is persisted via
// the existing onboarding draft endpoint (POST …/tax-status) so the wizard can
// resume; NO GST verification API is called here — GSTIN/enrolment
// verification happens in the later step.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { useBrandColors } from '@/components/ui/form';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts, Spacing } from '@/constants/theme';
import {
  saveSellerTaxStatus,
  sellerErrorCode,
  type SellerOnboardingState,
  type StepKey,
  type TaxStatus,
} from '@/lib/seller';


/** Server enum ↔ display. The enum is authoritative; labels never are. */
const OPTIONS: {
  value: TaxStatus;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  next: string;
}[] = [
  {
    value: 'regular_gst',
    icon: 'shield-checkmark-outline',
    title: 'Regular GST registered',
    sub: 'I have an active GSTIN under the regular scheme.',
    // Identity and PAN come first — a GSTIN can only be verified against an
    // already-verified PAN, so we can't ask for it before those steps.
    next: 'Next up: identity and PAN. You’ll enter your GSTIN at the Tax Registration step.',
  },
  {
    value: 'composition',
    icon: 'receipt-outline',
    title: 'Composition taxpayer',
    sub: 'I have a GSTIN and am registered under the composition scheme.',
    next: 'Next up: identity and PAN. You’ll verify your GSTIN and composition status at the Tax Registration step.',
  },
  {
    value: 'unregistered_enrolled',
    icon: 'storefront-outline',
    title: 'Not GST registered',
    sub: 'I want to sell as an eligible unregistered supplier.',
    next: 'Next up: identity and PAN. You’ll add your enrolment number and operating State/UT at the Tax Registration step.',
  },
];

export function TaxDetailsScreen({
  state,
  onStepPress,
  onDone,
}: {
  state: SellerOnboardingState;
  /** Jump to an earlier completed step via the progress rail. */
  onStepPress?: (s: StepKey) => void;
  onDone: () => Promise<void> | void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<TaxStatus | null>(state.taxStatus);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = OPTIONS.find((o) => o.value === selected);
  const infoText =
    chosen?.next ?? 'What we ask for later depends on the tax option you select.';

  async function submit() {
    if (!selected) return;
    setError(null);
    setSubmitting(true);
    try {
      await saveSellerTaxStatus(selected);
      await onDone();
    } catch (e) {
      const code = sellerErrorCode(e);
      setError(
        code === 'INVALID_TAX_STATUS'
          ? 'That option isn’t valid. Please pick another.'
          : 'Could not save. Check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <OnboardingStepHeader step="tax" onStepPress={onStepPress} />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero: headline left, tax illustration right. */}
        <View style={styles.heroRow}>
          <View style={{ flex: 1, gap: 7 }}>
            <Text style={[styles.h1, { color: c.text }]}>
              Tell us about your{'\n'}
              <Text style={{ color: c.primary }}>tax setup</Text>
            </Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>
              This helps us collect the right tax information for your business.
            </Text>
          </View>
          <Image
            source={require('../../assets/seller/tax-setup.png')}
            style={styles.heroArt}
            contentFit="contain"
            accessibilityLabel="Tax documents illustration"
          />
        </View>

        <View
          style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}
          accessibilityRole="radiogroup"
        >
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(99,102,241,0.16)' }]}>
              <Ionicons name="storefront-outline" size={18} color="#8B9CF6" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.cardTitle, { color: c.text }]}>
                How is your business registered for GST?
              </Text>
              <Text style={[styles.cardSub, { color: c.textSecondary }]}>
                Pick the option that matches your registration today — you can update it later if it
                changes.
              </Text>
            </View>
          </View>

          {OPTIONS.map((o) => {
            const active = selected === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => setSelected(o.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={o.title}
                accessibilityHint={o.sub}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? 'rgba(46,107,255,0.10)' : 'transparent',
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={[styles.radio, { borderColor: active ? c.primary : c.borderStrong }]}>
                  {active && <View style={[styles.radioInner, { backgroundColor: c.primary }]} />}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.optionTitle, { color: c.text }]}>{o.title}</Text>
                  <Text style={[styles.optionSub, { color: c.textSecondary }]}>{o.sub}</Text>
                </View>
                {active && <Ionicons name={o.icon} size={19} color={c.primary} />}
              </Pressable>
            );
          })}

          {/* Informational, never alarming — red is reserved for real errors. */}
          <View
            style={[styles.infoRow, { borderColor: c.border }]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons name="information-circle-outline" size={16} color={c.textSecondary} />
            <Text style={[styles.infoText, { color: c.textSecondary }]}>{infoText}</Text>
          </View>
        </View>

        {!!error && (
          <Text style={[styles.errorText, { color: c.danger }]} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
      </ScrollView>

      {/* Pinned CTA — always visible and clear of the tab bar, so it can
          never end up half-hidden below the fold. */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: c.background,
            borderTopColor: c.border,
            paddingBottom: insets.bottom + Spacing.two,
          },
        ]}
      >
        <Pressable
          onPress={submit}
          disabled={!selected || submitting}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !selected || submitting, busy: submitting }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: '#2E6BFF' },
            (!selected || submitting) && { opacity: 0.45 },
            pressed && !!selected && !submitting && { opacity: 0.85 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text style={styles.ctaText}>Continue</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </>
          )}
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.two + Spacing.one,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroArt: { width: 116, height: 106 },
  h1: { fontSize: 25, fontFamily: Fonts.sansSemiBold, lineHeight: 31 },
  sub: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18.5 },

  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.two + Spacing.one,
    gap: Spacing.two + 2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold, lineHeight: 20 },
  cardSub: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
    minHeight: 62,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: { width: 9, height: 9, borderRadius: 5 },
  optionTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  optionSub: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 15.5 },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
  },
  infoText: { flex: 1, fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },
  errorText: { fontSize: 12.5, fontFamily: Fonts.sans },

  footer: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 55,
    borderRadius: 16,
  },
  ctaText: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },
});
