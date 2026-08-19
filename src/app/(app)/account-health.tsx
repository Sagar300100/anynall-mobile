// Account health — replaces the Seller Tools stub with REAL account signals:
// email verification, policy acceptance, identity verification, seller
// standing and vacation mode — each read from where it actually lives. The
// one thing the platform does NOT have yet (a strikes/violations system) is
// said plainly instead of implied by an invented "100% healthy" score.
import Ionicons from '@expo/vector-icons/Ionicons';
import { doc, getDoc } from 'firebase/firestore';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import { db } from '@/lib/firebase';
import { getSellerOnboarding } from '@/lib/seller';
import { useSession } from '@/lib/session';

interface Signal {
  label: string;
  ok: boolean;
  detail: string;
  /** Where to fix it when not ok. */
  href?: string;
}

export default function AccountHealthScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();
  const { user } = useSession();
  const [signals, setSignals] = useState<Signal[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member' || !user) return;
      let cancelled = false;
      (async () => {
        const out: Signal[] = [];
        out.push({
          label: 'Email verified',
          ok: user.emailVerified === true,
          detail: user.emailVerified
            ? 'Your sign-in email is confirmed.'
            : 'Confirm your email to unlock everything.',
        });

        // Policy acceptance + Aadhaar — from the owner-readable users doc.
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          const d = snap.exists() ? (snap.data() as any) : {};
          out.push({
            label: 'Policies accepted',
            ok: d.termsAccepted === true && d.privacyAccepted === true && d.refundPolicyAccepted === true,
            detail:
              d.termsAccepted === true
                ? 'Terms, Privacy and Refund policies are on record.'
                : 'Acceptance is recorded on your next sign-in.',
          });
          out.push({
            label: 'Identity verified (Aadhaar)',
            ok: d.aadhaarVerified === true,
            detail:
              d.aadhaarVerified === true
                ? 'Verified — you can bid in every stream.'
                : 'Verify once via DigiLocker to bid in verified-only shows.',
            href: d.aadhaarVerified === true ? undefined : '/account/verify-identity',
          });
        } catch {
          /* doc unreadable — skip those signals rather than guess */
        }

        // Seller standing — only meaningful for sellers; a failed read means
        // the person simply isn't one, which is not a health problem.
        try {
          const s = await getSellerOnboarding();
          if (s.storeSetupComplete || s.completedAt) {
            out.push({
              label: 'Seller application',
              ok: s.applicationStatus === 'approved',
              detail:
                s.applicationStatus === 'approved'
                  ? 'Approved and in good standing.'
                  : `Status: ${s.applicationStatus.replace(/_/g, ' ')}.`,
              href: '/seller-status',
            });
            if (s.vacationMode === true) {
              out.push({
                label: 'Vacation mode',
                ok: false,
                detail: 'Your store is paused — buyers can’t purchase until you switch it off.',
                href: '/seller-tools',
              });
            }
          }
        } catch {
          /* not a seller — nothing to report */
        }

        if (!cancelled) setSignals(out);
      })();
      return () => {
        cancelled = true;
      };
    }, [status, user])
  );

  const problems = (signals || []).filter((s) => !s.ok).length;

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
        <Text style={[styles.topTitle, { color: c.text }]}>Account health</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt icon="shield-checkmark-outline" title="Sign in to see account health" body="Verification and standing signals for your account live here." reason="profile" />
      ) : signals === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.summary,
              {
                backgroundColor: c.cardBackground,
                borderColor: problems === 0 ? 'rgba(74,222,128,0.4)' : 'rgba(255,196,107,0.4)',
              },
            ]}
          >
            <Ionicons
              name={problems === 0 ? 'shield-checkmark' : 'shield-half-outline'}
              size={24}
              color={problems === 0 ? '#4ade80' : '#FFC46B'}
            />
            <Text style={[styles.summaryText, { color: c.text }]}>
              {problems === 0
                ? 'Everything checks out'
                : `${problems} thing${problems > 1 ? 's' : ''} could use attention`}
            </Text>
          </View>

          <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            {signals.map((s, i) => (
              <View key={s.label}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <Pressable
                  onPress={s.href ? () => router.push(s.href as never) : undefined}
                  disabled={!s.href}
                  accessibilityRole={s.href ? 'button' : undefined}
                  accessibilityLabel={s.label}
                  style={({ pressed }) => [styles.row, pressed && !!s.href && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={s.ok ? 'checkmark-circle' : 'alert-circle-outline'}
                    size={19}
                    color={s.ok ? '#4ade80' : '#FFC46B'}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>{s.label}</Text>
                    <Text style={[styles.rowDetail, { color: c.textSecondary }]}>{s.detail}</Text>
                  </View>
                  {!!s.href && <Ionicons name="chevron-forward" size={15} color={c.textFaint} />}
                </Pressable>
              </View>
            ))}
          </View>

          {/* Honest boundary: no strikes system exists yet. */}
          <Text style={[styles.note, { color: c.textFaint }]}>
            Any&All doesn’t run a strikes or violations system yet — when one launches, warnings
            and their appeal status will appear here.
          </Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three + Spacing.one,
  },
  summaryText: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },

  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontSize: 14, fontFamily: Fonts.sansMedium },
  rowDetail: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 17 },
  note: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 18 },
});
