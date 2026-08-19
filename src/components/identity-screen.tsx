// Identity — step 3 of seller onboarding (DigiLocker).
//
// HOW THE REAL FLOW WORKS (audited, not assumed):
//   POST /api/digilocker/init → Sandbox.co.in creates a DigiLocker session and
//   returns { sessionId, authUrl }. The app opens authUrl in a Chrome Custom
//   Tab / SFSafariViewController; the seller signs in and consents on the
//   government-hosted page. No Aadhaar number, password or OTP is ever entered
//   in Any&All, and no provider secret exists in the app bundle.
//
//   The provider's redirect_url is FIXED SERVER-SIDE to anynall.com — it is
//   not an app deep link — so DigiLocker cannot hand control back to the app.
//   Instead we treat two signals as "the seller is back": the browser promise
//   resolving (tab dismissed) and AppState returning to 'active'. Either one
//   triggers an automatic status check, so the manual button is a fallback
//   rather than a routine step.
//
//   POST /api/digilocker/complete { sessionId } is the authority: it verifies
//   the session belongs to this uid, downloads and parses the signed UIDAI
//   document server-side, requires the Aadhaar name to match the account name,
//   and persists the result. Returning to the app never means "verified".
import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingStepHeader } from '@/components/onboarding-step-header';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  completeDigiLocker,
  initDigiLocker,
  sellerErrorCode,
  type SellerOnboardingState,
  type StepKey,
} from '@/lib/seller';

const SESSION_KEY = 'anynall:digilocker-session';
/** Must match the `app` target in the backend's redirect allowlist. */
const APP_REDIRECT = 'anynallmobile://digilocker-complete';

type Phase =
  | 'idle'
  | 'creating'
  | 'opening'
  | 'checking'
  | 'pending'
  | 'verified'
  | 'cancelled'
  | 'expired'
  | 'error';

const STEPS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'globe-outline',
    title: 'Open DigiLocker',
    body: 'Sign in securely through the DigiLocker journey.',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Give consent',
    body: 'Approve sharing the required identity information.',
  },
  {
    icon: 'arrow-undo-outline',
    title: 'Return verified',
    body: 'Come back to Any&All and we’ll check your status automatically.',
  },
];

export function IdentityScreen({
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

  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>(state.aadhaarVerified ? 'verified' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  // Mirrored in state: refs may not be read during render.
  const [hasSession, setHasSession] = useState(false);
  // Guards the AppState listener so a resume can't double-fire a check.
  const checking = useRef(false);

  // Restore an interrupted session (survives the app being killed) and check
  // it straight away — this is the path taken when DigiLocker deep-links the
  // seller back through /digilocker-complete.
  useEffect(() => {
    if (state.aadhaarVerified) return;
    AsyncStorage.getItem(SESSION_KEY).then((s) => {
      if (!s) return;
      sessionId.current = s;
      setHasSession(true);
      void checkStatus(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.aadhaarVerified]);

  /** Ask the backend whether the provider actually verified this session. */
  async function checkStatus(auto: boolean) {
    const sid = sessionId.current;
    if (!sid || checking.current) return;
    checking.current = true;
    setPhase('checking');
    setMessage(null);
    try {
      const res = await completeDigiLocker(sid);
      if (res.verified) {
        await AsyncStorage.removeItem(SESSION_KEY);
        sessionId.current = null;
        setHasSession(false);
        setPhase('verified');
        return;
      }
      if (res.error === 'NAME_MISMATCH') {
        setPhase('error');
        setMessage(
          `The name on your Aadhaar (${res.aadhaarName ?? '—'}) doesn’t match your account name (${res.accountName ?? '—'}). They must match to verify.`
        );
      } else if (res.error === 'DIGILOCKER_INCOMPLETE') {
        setPhase('pending');
        setMessage(auto ? 'DigiLocker hasn’t confirmed yet — finish the journey, then check again.' : null);
      } else {
        setPhase('pending');
        setMessage(res.message ?? null);
      }
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code === 'SESSION_MISMATCH' || code === 'SESSION_EXPIRED') {
        await AsyncStorage.removeItem(SESSION_KEY);
        sessionId.current = null;
        setHasSession(false);
        setPhase('expired');
      } else {
        setPhase('error');
        setMessage('We couldn’t complete verification right now.');
      }
    } finally {
      checking.current = false;
    }
  }

  // Auto-check when the app comes back to the foreground with a live session.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (!sessionId.current || phase === 'verified' || phase === 'checking') return;
      void checkStatus(true);
    });
    return () => sub.remove();
  }, [phase]);

  async function startVerification() {
    setMessage(null);
    setPhase('creating');
    try {
      const { sessionId: sid, authUrl } = await initDigiLocker();
      sessionId.current = sid;
      await AsyncStorage.setItem(SESSION_KEY, sid);
      // The landing route uses this to return to the seller wizard (the
      // buyer Verified-identity screen stamps 'buyer').
      await AsyncStorage.setItem('anynall:digilocker-origin', 'seller');
      setHasSession(true);
      setPhase('opening');
      // Custom Tab / SFSafariViewController — never an embedded WebView, so
      // DigiLocker credentials stay in a browser Any&All can't read.
      //
      // openAuthSessionAsync watches for our custom scheme: when the backend
      // asked DigiLocker to redirect to anynallmobile://digilocker-complete,
      // the browser closes itself the moment consent finishes. On older
      // deployments the redirect still goes to the website, and this simply
      // resolves when the seller dismisses the tab instead.
      await WebBrowser.openAuthSessionAsync(authUrl, APP_REDIRECT);
      // Either way we're back — ask the backend what actually happened.
      await checkStatus(true);
    } catch (e) {
      const code = sellerErrorCode(e);
      if (code === 'ALREADY_VERIFIED') {
        setPhase('verified');
      } else if (code === 'KYC_ATTEMPTS_EXCEEDED') {
        setPhase('error');
        setMessage('Too many verification attempts. Please contact seller support.');
      } else {
        setPhase('error');
        setMessage('We couldn’t start verification. Check your connection and try again.');
      }
    }
  }

  const busy = phase === 'creating' || phase === 'opening' || phase === 'checking';
  const busyLabel =
    phase === 'creating'
      ? 'Creating secure verification…'
      : phase === 'opening'
        ? 'Opening DigiLocker…'
        : 'Checking your verification…';

  // ── Verified ────────────────────────────────────────────────────────────
  if (phase === 'verified') {
    // Every value comes from the backend record — nothing is assumed, and a
    // row is omitted rather than guessed when the field isn't returned.
    const verifiedRows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [];
    if (state.aadhaarVerifiedAt) {
      const d = new Date(state.aadhaarVerifiedAt);
      if (!Number.isNaN(d.getTime())) {
        verifiedRows.push({
          icon: 'calendar-outline',
          label: 'Verified on',
          value: `${d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        });
      }
    }
    verifiedRows.push({
      icon: 'shield-checkmark-outline',
      label: 'Verification method',
      value: state.aadhaarVerifiedVia === 'digilocker' || !state.aadhaarVerifiedVia
        ? 'DigiLocker'
        : state.aadhaarVerifiedVia,
    });
    verifiedRows.push({
      icon: 'person-outline',
      label: 'Verified for',
      value: 'Seller account',
    });

    return (
      <>
        <OnboardingStepHeader step="aadhaar" onStepPress={onStepPress} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.heroRow} accessibilityLiveRegion="polite">
            <View style={{ flex: 1, gap: 7 }}>
              <Text style={[styles.h1, { color: c.text }]}>
                Identity <Text style={{ color: '#34D399' }}>verified</Text>
              </Text>
              <Text style={[styles.sub, { color: c.textSecondary }]}>
                Your seller identity verification is complete.
              </Text>
            </View>
            <Image
              source={require('../../assets/seller/identity.png')}
              style={styles.heroArt}
              contentFit="contain"
              accessibilityLabel="Identity verified illustration"
            />
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: 'rgba(52,211,153,0.06)', borderColor: 'rgba(52,211,153,0.45)' },
            ]}
          >
            <View style={styles.resultHead}>
              <Ionicons name="checkmark-circle" size={20} color="#34D399" />
              <Text style={[styles.resultTitle, { color: '#34D399' }]}>Verified via DigiLocker</Text>
            </View>
            {/* Wording matches what the integration actually proves: the
                DigiLocker journey completed and the document was validated. */}
            <Text style={[styles.privacyText, { color: c.textSecondary }]}>
              Your identity was confirmed through the secure DigiLocker verification process.
            </Text>
          </View>

          <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border, gap: 0 }]}>
            {verifiedRows.map((r, i) => (
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
                <Text style={[styles.detailValue, { color: c.textSecondary }]} numberOfLines={2}>
                  {r.value}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.securityRow}>
            <Ionicons name="lock-closed-outline" size={15} color={c.textSecondary} />
            <Text style={[styles.privacyText, { color: c.textSecondary }]}>
              Your information is protected and used only for seller identity verification.
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

  // ── Not verified ────────────────────────────────────────────────────────
  return (
    <>
      <OnboardingStepHeader step="aadhaar" onStepPress={onStepPress} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.heroRow}>
          <View style={{ flex: 1, gap: 7 }}>
            <Text style={[styles.h1, { color: c.text }]}>Verify your identity</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>
              Complete a secure one-time verification through DigiLocker.
            </Text>
          </View>
          <Image
            source={require('../../assets/seller/identity.png')}
            style={styles.heroArt}
            contentFit="contain"
            accessibilityLabel="Identity verification illustration"
          />
        </View>

        <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(99,102,241,0.16)' }]}>
              <Ionicons name="document-lock-outline" size={18} color="#8B9CF6" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.cardTitle, { color: c.text }]}>Secure verification with DigiLocker</Text>
              <Text style={[styles.cardSub, { color: c.textSecondary }]}>
                You’ll complete the verification securely through DigiLocker and return to Any&All.
              </Text>
            </View>
          </View>

          {STEPS.map((s, i) => (
            <View key={s.title} style={styles.stepRow}>
              <View style={[styles.stepMarker, { borderColor: 'rgba(74,143,229,0.45)' }]}>
                <Ionicons name={s.icon} size={15} color={c.primary} />
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={[styles.stepTitle, { color: c.text }]}>
                  {i + 1}. {s.title}
                </Text>
                <Text style={[styles.stepBody, { color: c.textSecondary }]}>{s.body}</Text>
              </View>
            </View>
          ))}

          <View style={[styles.privacyRow, { borderColor: c.border }]}>
            <Ionicons name="lock-closed-outline" size={14} color={c.textSecondary} />
            <Text style={[styles.privacyText, { color: c.textSecondary }]}>
              Your information is encrypted and used only for seller verification.
            </Text>
          </View>
        </View>

        {!!message && (
          <View
            style={[
              styles.noteRow,
              { borderColor: phase === 'error' ? 'rgba(229,72,77,0.45)' : c.border },
            ]}
            accessibilityLiveRegion="polite"
          >
            <Ionicons
              name={phase === 'error' ? 'alert-circle-outline' : 'time-outline'}
              size={16}
              color={phase === 'error' ? '#E5484D' : '#E8B03F'}
            />
            <Text style={[styles.noteText, { color: c.textSecondary }]}>{message}</Text>
          </View>
        )}

        {phase === 'expired' && (
          <View style={[styles.noteRow, { borderColor: c.border }]} accessibilityLiveRegion="polite">
            <Ionicons name="time-outline" size={16} color="#E8B03F" />
            <Text style={[styles.noteText, { color: c.textSecondary }]}>
              This verification request has expired. Start a new one below.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => setConsent(!consent)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: consent }}
          accessibilityLabel="I consent to share the required identity information through DigiLocker for one-time seller verification."
          style={({ pressed }) => [styles.consentRow, pressed && { opacity: 0.75 }]}
        >
          <View
            style={[
              styles.checkBox,
              { borderColor: consent ? c.primary : c.borderStrong },
              consent && { backgroundColor: c.primary },
            ]}
          >
            {consent && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
          </View>
          <Text style={[styles.consentText, { color: c.textSecondary }]}>
            I consent to share the required identity information through DigiLocker for one-time
            seller verification.
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: c.background, borderTopColor: c.border, paddingBottom: insets.bottom + Spacing.two },
        ]}
      >
        <Pressable
          onPress={startVerification}
          disabled={!consent || busy}
          accessibilityRole="button"
          accessibilityLabel={phase === 'expired' ? 'Start a new verification' : 'Verify with DigiLocker'}
          accessibilityState={{ disabled: !consent || busy, busy }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: '#2E6BFF' },
            (!consent || busy) && { opacity: 0.45 },
            pressed && consent && !busy && { opacity: 0.85 },
          ]}
        >
          {busy ? (
            <>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.ctaText}>{busyLabel}</Text>
            </>
          ) : (
            <>
              <Ionicons name="document-lock-outline" size={19} color="#FFFFFF" />
              <Text style={styles.ctaText}>
                {phase === 'expired' || phase === 'cancelled' ? 'Start a new verification' : 'Verify with DigiLocker'}
              </Text>
            </>
          )}
        </Pressable>

        {/* Fallback only — the automatic check on return is the normal path. */}
        {hasSession && !busy && (phase === 'pending' || phase === 'error') && (
          <Pressable
            onPress={() => checkStatus(false)}
            accessibilityRole="button"
            accessibilityLabel="Check verification status"
            style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.secondaryText, { color: c.primary }]}>Check verification status</Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two + Spacing.one },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroArt: { width: 116, height: 96 },
  h1: { fontSize: 25, fontFamily: Fonts.sansSemiBold, lineHeight: 31 },
  sub: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18.5 },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.two + Spacing.one, gap: Spacing.two + 2 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  cardIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold, lineHeight: 20 },
  cardSub: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  stepMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: { fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  stepBody: { fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  privacyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
  },
  privacyText: { flex: 1, fontSize: 11.5, fontFamily: Fonts.sans, lineHeight: 16 },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },

  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  consentText: { flex: 1, fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },

  resultHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  resultTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two + 2,
  },
  detailIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  detailLabel: { flex: 1, fontSize: 13, fontFamily: Fonts.sansMedium },
  detailValue: { fontSize: 12.5, fontFamily: Fonts.sans, textAlign: 'right', maxWidth: '48%' },
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
  secondary: { alignItems: 'center', paddingVertical: Spacing.two, minHeight: 40, justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontFamily: Fonts.sansMedium },
});
