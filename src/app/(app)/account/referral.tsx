// Refer & earn — mobile port of the website's sellerhub ReferralsPanel
// against GET /api/profile/referral (the code is lazily created server-side
// on first read, so this never 404s).
//
// PARITY NOTE — the website's AffiliatePage is a marketing mock (dead
// buttons, no Impact.com integration); the REAL referral surface is the
// seller hub panel this ports. There is no invite-tracking backend yet, so no
// counters are shown — a genuine link and a share sheet, nothing invented.
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Eyebrow } from '@/components/brand/eyebrow';
import { GlassCard } from '@/components/brand/glass-card';
import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Brand, CtaGradientShell, Fonts, Shadows, Spacing } from '@/constants/theme';
import { getMyReferral } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';

const STEPS: { icon: string; text: string }[] = [
  { icon: 'link-outline', text: 'Share your referral link with friends — shoppers or creators who could sell on Any&All.' },
  { icon: 'person-add-outline', text: 'They sign up with your link. Sellers verify KYC, go live and complete their first sale and shipment.' },
  { icon: 'gift-outline', text: 'You earn a referral bonus once they finish those steps — and they get their own starter bonus too.' },
];

export default function ReferralScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    getMyReferral()
      .then((r) => {
        if (cancelled) return;
        setCode(r.code || '');
        setLink(r.link || '');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your referral code. Pull back and retry.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function share() {
    if (!link || sharing) return;
    setSharing(true);
    try {
      await Share.share({
        message: `Shop live on Any&All — India's live shopping marketplace. Join with my invite: ${link}`,
      });
    } catch {
      /* user dismissed the sheet — nothing to report */
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
        <Text style={[styles.topTitle, { color: c.text }]}>Refer friends</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="gift-outline"
          title="Sign in to get your referral link"
          body="Invite friends to Any&All and earn a bonus when they complete their first steps."
          reason="profile"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Invite friends to shop — or sell — on Any&All. When they join with your link and
            complete their first steps, you both earn a bonus.
          </Text>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : error ? (
            <Text style={[styles.body, { color: c.danger }]}>{error}</Text>
          ) : (
            <>
              <GlassCard variant="panel" style={styles.codeCard}>
                <Text style={[styles.codeLabel, { color: c.textFaint }]}>YOUR CODE</Text>
                <Text
                  selectable
                  accessibilityLabel={`Referral code ${code}`}
                  style={styles.code}
                >
                  {code}
                </Text>
                <Text selectable style={[styles.link, { color: c.textSecondary }]} numberOfLines={2}>
                  {link}
                </Text>
                <Text style={[styles.hint, { color: c.textFaint }]}>
                  Long-press the code or link to copy it.
                </Text>
              </GlassCard>

              <PressScale
                onPress={share}
                disabled={sharing || !link}
                accessibilityRole="button"
                accessibilityLabel="Share your referral link"
                style={[styles.shareBtn, Shadows.cta, sharing && { opacity: 0.8 }]}
              >
                <LinearGradient
                  colors={[...CtaGradientShell]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.shareBtnFill}
                >
                  {sharing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="share-social-outline" size={17} color="#FFFFFF" />
                      <Text style={[styles.shareBtnText, { color: '#FFFFFF' }]}>Share your link</Text>
                    </>
                  )}
                </LinearGradient>
              </PressScale>

              <Eyebrow style={styles.sectionLabel}>How it works</Eyebrow>
              <View style={styles.steps}>
                {STEPS.map((s, i) => (
                  <View key={s.icon}>
                    {i > 0 && <View style={[styles.divider, { backgroundColor: Brand.hairlineWhite }]} />}
                    <View style={styles.stepRow}>
                      <View style={[styles.stepIcon, { backgroundColor: 'rgba(30,111,255,0.14)' }]}>
                        <Ionicons name={s.icon as never} size={16} color={c.primary} />
                      </View>
                      <Text style={[styles.stepText, { color: c.textSecondary }]}>{s.text}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Honest, per the backend comment: no invite tracking exists yet. */}
              <Text style={[styles.hint, { color: c.textFaint }]}>
                Referral activity tracking is coming soon — for now your link works, and bonuses
                are applied by the team once your referral completes their steps.
              </Text>
            </>
          )}
        </ScrollView>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: Spacing.six },
  body: { fontSize: 14, fontFamily: Fonts.ui, lineHeight: 21 },
  loading: { paddingVertical: Spacing.five, alignItems: 'center' },

  codeCard: {
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  codeLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 2 },
  code: { fontFamily: Fonts.mono, fontSize: 26, letterSpacing: 3, color: Brand.blueSky },
  link: { fontSize: 12.5, fontFamily: Fonts.ui, textAlign: 'center' },
  hint: { fontSize: 12, fontFamily: Fonts.ui, lineHeight: 17, textAlign: 'center' },

  shareBtn: { borderRadius: 13 },
  shareBtnFill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 13,
    minHeight: 48,
    overflow: 'hidden',
  },
  shareBtnText: { fontSize: 14.5, fontFamily: Fonts.uiBold },

  sectionLabel: { marginLeft: 4, marginBottom: -Spacing.two },
  steps: {
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
  },
  divider: { height: StyleSheet.hairlineWidth },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    paddingVertical: Spacing.three,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1, fontSize: 13.5, fontFamily: Fonts.ui, lineHeight: 19 },
});
