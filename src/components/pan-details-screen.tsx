// PAN — step 4 of seller onboarding.
//
// Verification is entirely server-side (POST /api/pan/verify → Sandbox/NSDL):
// the backend validates the PAN, reads the holder name, and matches it against
// the Aadhaar name captured during DigiLocker — the seller can't self-declare
// past it. The full PAN is KMS-encrypted server-side; only a masked form ever
// reaches this screen. A correctly formatted PAN is never treated as verified.
//
// The provider needs a date of birth when Aadhaar didn't supply one; that
// arrives as HTTP 200 with error:"DOB_REQUIRED", not a 4xx, so the field is
// revealed on demand rather than always shown.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { Field, useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { sellerErrorCode, verifyPan, type SellerOnboardingState, type StepKey } from '@/lib/seller';

/** Structure only — never proof of existence or ownership. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const RULES = ['10-character PAN format', 'Uppercase letters only', 'Must belong to you'];

type Result =
  | { kind: 'none' }
  | { kind: 'verified'; masked?: string }
  | { kind: 'mismatch'; message: string }
  | { kind: 'review'; message: string }
  | { kind: 'error'; message: string };

export function PanDetailsScreen({
  state,
  onStepPress,
  onDone,
}: {
  state: SellerOnboardingState;
  onStepPress?: (s: StepKey) => void;
  onDone: () => Promise<void> | void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();

  const [pan, setPan] = useState('');
  const [dob, setDob] = useState('');
  const [needDob, setNeedDob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'none' });

  const formatOk = PAN_RE.test(pan);
  const showFormatError = pan.length === 10 && !formatOk;
  const dobOk = !needDob || /^\d{4}-\d{2}-\d{2}$/.test(dob);
  // Identity must be verified first: the backend matches PAN against that name.
  const canSubmit = formatOk && dobOk && !busy && state.aadhaarVerified;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setResult({ kind: 'none' });
    try {
      const res = await verifyPan(pan, needDob && dob ? dob : undefined);
      if (res.verified) {
        setResult({ kind: 'verified', masked: res.maskedPan });
        return;
      }
      switch (res.error) {
        case 'DOB_REQUIRED':
          setNeedDob(true);
          setResult({
            kind: 'error',
            message: 'Add your date of birth (as on your Aadhaar) to continue.',
          });
          break;
        case 'DOB_MISMATCH':
          setResult({ kind: 'error', message: 'That date of birth doesn’t match this PAN.' });
          break;
        case 'NAME_MISMATCH':
          setResult({
            kind: 'mismatch',
            message: 'Use a PAN belonging to the same person verified through DigiLocker.',
          });
          break;
        case 'AADHAAR_FIRST':
          setResult({ kind: 'error', message: 'Complete identity verification first.' });
          break;
        case 'INVALID_PAN':
          setResult({ kind: 'error', message: 'Enter a valid 10-character PAN.' });
          break;
        default:
          setResult({
            kind: 'error',
            message: res.message || 'Check the number and try again.',
          });
      }
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code === 'ALREADY_VERIFIED') {
        setResult({ kind: 'verified' });
      } else if (code === 'KYC_ATTEMPTS_EXCEEDED') {
        setResult({ kind: 'review', message: 'Too many attempts. Please contact seller support.' });
      } else if (code === 'IDENTITY_ALREADY_USED') {
        setResult({
          kind: 'mismatch',
          message: 'This PAN is already linked to another Any&All account.',
        });
      } else {
        setResult({
          kind: 'error',
          message: 'PAN verification is temporarily unavailable. Please try again.',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const alreadyVerified = state.panVerified || result.kind === 'verified';

  // ── Verified ────────────────────────────────────────────────────────────
  if (alreadyVerified) {
    const masked = (result.kind === 'verified' ? result.masked : null) ?? state.panMasked ?? null;
    const when = state.panVerifiedAt ? new Date(state.panVerifiedAt) : null;
    const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [];
    if (masked) rows.push({ icon: 'card-outline', label: 'PAN', value: masked });
    rows.push({ icon: 'shield-checkmark-outline', label: 'Verification status', value: 'Verified' });
    rows.push({ icon: 'person-outline', label: 'Name match', value: 'Confirmed' });
    if (when && !Number.isNaN(when.getTime())) {
      rows.push({
        icon: 'calendar-outline',
        label: 'Verified on',
        value: `${when.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}, ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      });
    }

    return (
      <>
        <OnboardingStepHeader step="pan" onStepPress={onStepPress} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.heroRow} accessibilityLiveRegion="polite">
            <View style={{ flex: 1, gap: 7 }}>
              <Text style={[styles.h1, { color: c.text }]}>
                PAN <Text style={{ color: '#34D399' }}>verified</Text>
              </Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                Your PAN has been verified and matched with your identity.
              </Text>
            </View>
            <View style={[styles.heroBadge, { borderColor: 'rgba(52,211,153,0.45)' }]}>
              <Ionicons name="checkmark-circle" size={34} color="#34D399" />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border, gap: 0 }]}>
            {rows.map((r, i) => (
              <View
                key={r.label}
                style={[
                  styles.detailRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
                accessible
                accessibilityLabel={`${r.label}: ${r.value}`}
              >
                <View style={[styles.detailIcon, { backgroundColor: 'rgba(99,102,241,0.16)' }]}>
                  <Ionicons name={r.icon} size={15} color="#8B9CF6" />
                </View>
                <Text style={[styles.detailLabel, { color: c.text }]}>{r.label}</Text>
                <Text style={[styles.detailValue, { color: c.textSecondary }]}>{r.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.securityRow}>
            <Ionicons name="lock-closed-outline" size={15} color={c.textSecondary} />
            <Text style={[styles.privacyText, { color: c.textSecondary }]}>
              Your PAN is protected and used only for seller payouts, tax compliance and required
              verification.
            </Text>
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: c.background, borderTopColor: c.border, paddingBottom: insets.bottom + Spacing.two }]}>
          <Pressable
            onPress={() => onDone()}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            style={({ pressed }) => [styles.cta, { backgroundColor: '#2E6BFF' }, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.ctaText}>Continue</Text>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </>
    );
  }

  // ── Entry ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <OnboardingStepHeader step="pan" onStepPress={onStepPress}>
        <Text style={[styles.h1, { color: c.text }]}>Verify your PAN</Text>
        <Text style={[styles.sub, { color: c.textSecondary }]}>
          PAN is required for seller payouts and tax compliance. The PAN-holder name must match your
          verified identity.
        </Text>
      </OnboardingStepHeader>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.five }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.cardTitle, { color: c.text }]}>Enter your PAN</Text>
              <Text style={[styles.cardSub, { color: c.textSecondary }]}>
                We’ll verify it and match it with your identity.
              </Text>
            </View>
            {/* Abstract tax-identity artwork — deliberately NOT a replica of a
                real PAN card: no emblem, no department wordmark, no QR, no
                number. Generated by scripts/generate-pan-art.mjs. */}
            <Image
              source={require('../../assets/seller/pan-card.png')}
              style={styles.cardArt}
              contentFit="contain"
              accessibilityIgnoresInvertColors
              accessible={false}
            />
          </View>

          <Field
            label="PAN number"
            value={pan}
            onChangeText={(t) => setPan(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            maxLength={10}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="ABCDE1234F"
            accessibilityLabel="PAN number"
            error={showFormatError ? 'Enter a valid 10-character PAN.' : null}
            rightSlot={
              pan.length > 0 ? (
                <Pressable onPress={() => setPan('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear PAN">
                  <Ionicons name="close-circle" size={18} color={c.textSecondary} />
                </Pressable>
              ) : undefined
            }
          />

          {needDob && (
            <Field
              label="Date of birth (as on your Aadhaar)"
              value={dob}
              onChangeText={setDob}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              accessibilityLabel="Date of birth"
            />
          )}

          <View style={styles.rules}>
            {RULES.map((r, i) => (
              <View key={r} style={styles.ruleItem}>
                {i > 0 && <View style={[styles.ruleDivider, { backgroundColor: c.border }]} />}
                <Ionicons name="checkmark-circle-outline" size={13} color={c.primary} />
                <Text style={[styles.ruleText, { color: c.textSecondary }]} numberOfLines={2}>
                  {r}
                </Text>
              </View>
            ))}
          </View>

          <View style={[styles.privacyBox, { borderColor: c.border }]}>
            <Ionicons name="shield-checkmark-outline" size={19} color={c.primary} />
            <Text style={[styles.privacyText, { color: c.textSecondary }]}>
              We use this only for tax compliance and seller payouts.
            </Text>
            <Ionicons name="lock-closed-outline" size={15} color={c.textFaint} />
          </View>

          {/* CTA lives inside the card, per the approved layout. */}
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Verify PAN"
            accessibilityState={{ disabled: !canSubmit, busy }}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: '#2E6BFF' },
              !canSubmit && { opacity: 0.45 },
              pressed && canSubmit && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.ctaText}>Verifying your PAN…</Text>
              </>
            ) : (
              <Text style={styles.ctaText}>Verify PAN</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setWhyOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Why we need this"
            accessibilityState={{ expanded: whyOpen }}
            hitSlop={8}
            style={({ pressed }) => [styles.whyRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.whyText, { color: c.primary }]}>Why we need this</Text>
            <Ionicons name={whyOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={c.primary} />
          </Pressable>

          {whyOpen && (
            <Text style={[styles.whyBody, { color: c.textSecondary }]}>
              Indian tax rules require a PAN for marketplace sellers before payouts can be released.
              We verify it with the issuing database and check the holder name matches the identity
              you verified, so payouts can’t be routed to someone else.
            </Text>
          )}
        </View>

        {result.kind !== 'none' && (
          <View
            style={[
              styles.resultRow,
              {
                borderColor:
                  result.kind === 'review' ? 'rgba(232,176,63,0.45)' : 'rgba(229,72,77,0.45)',
              },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons
              name={result.kind === 'review' ? 'time-outline' : 'alert-circle-outline'}
              size={16}
              color={result.kind === 'review' ? '#E8B03F' : '#E5484D'}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[
                  styles.resultTitle,
                  { color: result.kind === 'review' ? '#E8B03F' : '#E5484D' },
                ]}
              >
                {result.kind === 'mismatch'
                  ? 'PAN name doesn’t match your verified identity'
                  : result.kind === 'review'
                    ? 'Your PAN needs additional review'
                    : 'We couldn’t verify this PAN'}
              </Text>
              <Text style={[styles.privacyText, { color: c.textSecondary }]}>{result.message}</Text>
            </View>
          </View>
        )}

        {!state.aadhaarVerified && (
          <View style={[styles.resultRow, { borderColor: c.border }]}>
            <Ionicons name="information-circle-outline" size={16} color={c.textSecondary} />
            <Text style={[styles.privacyText, { color: c.textSecondary, flex: 1 }]}>
              Complete identity verification first — we match your PAN against it.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two + Spacing.one },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroBadge: {
    width: 68,
    height: 68,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  h1: { fontSize: 25, fontFamily: Fonts.sansSemiBold, lineHeight: 31 },
  sub: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18.5 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.two + Spacing.one, gap: Spacing.two + 2 },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  cardSub: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardArt: { width: 104, height: 69 },

  rules: { flexDirection: 'row', alignItems: 'center' },
  ruleItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  ruleDivider: { width: StyleSheet.hairlineWidth, height: 18, marginRight: Spacing.one },
  ruleText: { flex: 1, fontSize: 10, fontFamily: Fonts.sans, lineHeight: 13 },

  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
  },
  whyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4 },
  whyText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },
  whyBody: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16.5 },
  privacyText: { flex: 1, fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
  },
  resultTitle: { fontSize: 13, fontFamily: Fonts.sansSemiBold },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
  },
  detailIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  detailLabel: { flex: 1, fontSize: 13, fontFamily: Fonts.sansMedium },
  detailValue: { fontSize: 12.5, fontFamily: Fonts.sans, textAlign: 'right' },
  securityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: 2 },

  footer: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 55,
    borderRadius: 16,
  },
  ctaText: { color: '#FFFFFF', fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
});
