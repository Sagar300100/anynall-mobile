// Sell — the Seller Hub tab (replaces Favourites).
//
// Guest → sign-in prompt. Signed in → real onboarding state from
// GET /api/profile/seller-onboarding:
//   - onboarding incomplete → the nine-step wizard (progress server-saved)
//   - onboarding complete   → hub home with the real application status
//
// Nothing here is faked: statuses, store name and steps all come from the
// backend, and the only external link is the real web Seller Hub.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { SellerHub } from '@/components/seller-hub';
import { SellerIntro } from '@/components/seller-intro';
import { SellerWizard } from '@/components/seller-wizard';
import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { getSellerOnboarding, isOnboardingDone, type SellerOnboardingState } from '@/lib/seller';
import { useSession } from '@/lib/session';

export default function SellScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const { user } = useSession();

  const [state, setState] = useState<SellerOnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Approved sellers land on the hub; "Go to Seller Hub" from the wizard's
  // final step flips this without waiting for a refetch.
  const [showHub, setShowHub] = useState(false);
  // The intro page shows first; the wizard opens only after the CTA. Tab
  // screens stay mounted, so reset on blur — every visit to the Sell tab
  // starts at the intro until the user is actually a seller.
  //
  // Exception: `?resume=1` (set by the DigiLocker return) goes straight back
  // into the flow — that seller is mid-application, not choosing to start one.
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  const [entered, setEntered] = useState(() => resume === '1');
  useFocusEffect(
    useCallback(() => {
      return () => setEntered(false);
    }, [])
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await getSellerOnboarding();
      setState(s);
    } catch {
      setError("Couldn't load your seller status. Pull to retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSellerOnboarding();
        if (!cancelled) setState(s);
      } catch {
        if (!cancelled) setError("Couldn't load your seller status.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, user?.uid]);

  // The onboarding flow (wizard + Store Info) renders its own header with a
  // back arrow, so the tab's own top bar hides while it's open.
  const inFlow =
    status === 'member' && !loading && !error && !!state && entered && !showHub && !isOnboardingDone(state);
  // The Seller Hub dashboard owns its own title bar and Seller Tools button,
  // so the tab's top bar hides there too — otherwise the screen carries two
  // headers and two competing top-right actions.
  const onHub =
    status === 'member' && !loading && !error && !!state && (showHub || isOnboardingDone(state));

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      {!inFlow && !onHub && (
      <View style={styles.topBar}>
        <View style={styles.topTitleBlock}>
          <Eyebrow>Sell on Any&All</Eyebrow>
          <Text style={[styles.topTitle, { color: c.text }]}>Seller Hub</Text>
        </View>
        <PressScale
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={6}
          style={styles.settingsBtn}
        >
          <Ionicons name="settings-outline" size={18} color={Brand.slate400} />
        </PressScale>
      </View>
      )}

      {status === 'loading' ? null : status === 'guest' ? (
        // Guests get the same intro; the CTA routes through sign-in and
        // returns here afterwards (useReturnAfterAuth on the auth screens).
        <SellerIntro
          ctaLabel="Start selling"
          onStart={() => router.push({ pathname: '/sign-in', params: { reason: 'sell' } })}
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : error || !state ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={c.textSecondary} />
          <Text style={[styles.errorTitle, { color: c.text }]}>Couldn’t load your seller status</Text>
          <PressScale
            onPress={() => {
              setLoading(true);
              load();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            style={styles.retryBtn}
          >
            <Text style={[styles.retryText, { color: c.text }]}>Retry</Text>
          </PressScale>
        </View>
      ) : showHub || isOnboardingDone(state) ? (
        <SellerHub state={state} onRefresh={() => load()} />
      ) : !entered ? (
        <SellerIntro
          ctaLabel={
            state.storeSetupComplete || !!state.taxStatus || state.aadhaarVerified
              ? 'Continue setup'
              : 'Start selling'
          }
          onStart={() => setEntered(true)}
        />
      ) : (
        // The wizard owns every step, including Store Info — it starts at the
        // first incomplete one and its chips allow going back to edit.
        <SellerWizard
          state={state}
          onRefresh={load}
          onDone={() => setShowHub(true)}
          onExit={() => setEntered(false)}
        />
      )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    minHeight: 46,
  },
  topTitleBlock: { flex: 1, gap: Spacing.one },
  topTitle: { fontSize: 24, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.five },
  errorTitle: { fontSize: 16, fontFamily: Fonts.uiSemiBold },
  retryBtn: { borderWidth: 1, borderColor: Brand.hairline, borderRadius: 13, paddingHorizontal: Spacing.four, paddingVertical: 10 },
  retryText: { fontSize: 14, fontFamily: Fonts.uiMedium },

  hubScroll: { padding: Spacing.three, gap: Spacing.three },
  hubHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  storeMark: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeName: { fontSize: 19, fontFamily: Fonts.uiSemiBold },
  storeHandle: { fontSize: 13, fontFamily: Fonts.ui },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
  },
  statusTitle: { fontSize: 14.5, fontFamily: Fonts.uiSemiBold },
  statusBody: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 17.5 },
  webRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
  },
  webRowTitle: { fontSize: 14.5, fontFamily: Fonts.uiSemiBold },
  webRowBody: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 17 },
});
