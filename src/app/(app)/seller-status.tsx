// Seller status — replaces the Seller Tools stub with the seller's REAL
// standing, read from the same onboarding state the wizard maintains:
// application status, each verification's true state, store identity, and
// vacation mode. Nothing here is computed client-side — it renders exactly
// what the server holds.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { getSellerOnboarding, type SellerOnboardingState } from '@/lib/seller';

const APPLICATION_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  approved: { label: 'Approved — you can sell', tone: 'ok' },
  submitted: { label: 'Submitted — under review', tone: 'warn' },
  pending_review: { label: 'Under review', tone: 'warn' },
  action_required: { label: 'Action required', tone: 'bad' },
  rejected: { label: 'Rejected', tone: 'bad' },
  draft: { label: 'In progress — finish the wizard', tone: 'warn' },
};

const TONE_COLOR = { ok: '#4ade80', warn: '#FFC46B', bad: '#F87171' } as const;

export default function SellerStatusScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const [state, setState] = useState<SellerOnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      (async () => {
        try {
          const s = await getSellerOnboarding();
          if (!cancelled) setState(s);
        } catch {
          if (!cancelled) setError('Couldn’t load your seller status. Try again shortly.');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [status])
  );

  const app = state ? APPLICATION_LABEL[state.applicationStatus] || APPLICATION_LABEL.draft : null;

  const checks: { label: string; done: boolean; detail?: string }[] = state
    ? [
        { label: 'Store information', done: state.storeSetupComplete, detail: state.storeName ? `${state.storeName} · @${state.storeHandle}` : undefined },
        { label: 'Aadhaar identity', done: state.aadhaarVerified, detail: state.aadhaarVerifiedVia === 'digilocker' ? 'Verified via DigiLocker' : undefined },
        { label: 'PAN', done: state.panVerified, detail: state.panMasked || undefined },
        { label: 'Bank account', done: state.bankVerified, detail: state.bankMasked ? `${state.bankMasked}${state.bankIfsc ? ` · ${state.bankIfsc}` : ''}` : undefined },
        {
          label: 'Tax status',
          done: state.gstVerificationStatus === 'verified' || state.gstVerificationStatus === 'not_required' || state.enrolmentVerificationStatus === 'verified',
          detail: state.gstMasked || (state.taxStatus === 'unregistered_enrolled' ? 'Enrolled (unregistered)' : undefined) || undefined,
        },
        { label: 'Seller agreement', done: state.sellerTermsAccepted },
      ]
    : [];

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
        <Text style={[styles.topTitle, { color: c.text }]}>Seller status</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt icon="list-outline" title="Sign in to see your status" body="Your seller application and verifications live here." reason="sell" />
      ) : state === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.body, { color: c.textSecondary }]}>{error}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ── Application ── */}
          {!!app && (
            <View style={[styles.appCard, { backgroundColor: c.cardBackground, borderColor: `${TONE_COLOR[app.tone]}55` }]}>
              <Ionicons
                name={app.tone === 'ok' ? 'checkmark-circle' : app.tone === 'warn' ? 'time-outline' : 'alert-circle-outline'}
                size={22}
                color={TONE_COLOR[app.tone]}
              />
              <View style={styles.appText}>
                <Text style={[styles.appLabel, { color: c.text }]}>{app.label}</Text>
                <Text style={[styles.appSub, { color: c.textSecondary }]}>
                  {state!.completedAt
                    ? 'Your application is complete.'
                    : 'Finish the remaining steps in the Seller Hub wizard.'}
                </Text>
              </View>
            </View>
          )}

          {/* ── Verifications ── */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>VERIFICATIONS</Text>
          <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            {checks.map((ck, i) => (
              <View key={ck.label}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <View style={styles.row}>
                  <Ionicons
                    name={ck.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={19}
                    color={ck.done ? '#4ade80' : c.textFaint}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>{ck.label}</Text>
                    {!!ck.detail && (
                      <Text style={[styles.rowDetail, { color: c.textSecondary }]} numberOfLines={1}>
                        {ck.detail}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.rowState, { color: ck.done ? '#4ade80' : c.textFaint }]}>
                    {ck.done ? 'Done' : 'Pending'}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── Selling scope ── */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>SELLING SCOPE</Text>
          <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            <View style={styles.row}>
              <Ionicons name="map-outline" size={19} color={c.primary} />
              <View style={styles.rowText}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {state!.interstateSalesAllowed ? 'Sell across India' : 'Same-State selling only'}
                </Text>
                <Text style={[styles.rowDetail, { color: c.textSecondary }]}>
                  {state!.interstateSalesAllowed
                    ? 'Your tax registration allows delivery to any State.'
                    : 'Your current tax status limits delivery to buyers in your own State (GST rules).'}
                </Text>
              </View>
            </View>
            {state!.vacationMode === true && (
              <>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <View style={styles.row}>
                  <Ionicons name="airplane-outline" size={19} color="#FFC46B" />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>Vacation mode is ON</Text>
                    <Text style={[styles.rowDetail, { color: c.textSecondary }]}>
                      Turn it off in Seller Tools → Settings when you’re back.
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>

          {!state!.completedAt && (
            <Pressable
              onPress={() => router.push('/sell')}
              accessibilityRole="button"
              accessibilityLabel="Continue your seller application"
              style={({ pressed }) => [styles.cta, { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.ctaText, { color: c.ctaText }]}>Continue application</Text>
            </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21, textAlign: 'center' },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4, marginBottom: -Spacing.one },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },

  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
  },
  appText: { flex: 1, gap: 2 },
  appLabel: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  appSub: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    minHeight: 54,
  },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 14, fontFamily: Fonts.sansMedium },
  rowDetail: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 17 },
  rowState: { fontSize: 12, fontFamily: Fonts.sansSemiBold },

  cta: { borderRadius: 999, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
