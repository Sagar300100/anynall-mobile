// Shared auth-surface components (sign-in + sign-up): brand lockup with the
// LIVE badge, gradient heading word, gradient CTA, and the social buttons.
// One implementation so the two screens can't drift apart.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, FeGaussianBlur, Filter, Rect } from 'react-native-svg';

import { AppleIcon, GoogleIcon } from '@/components/provider-icons';
import { useBrandColors } from '@/components/ui/form';
import { Brand, CtaGradientShell, Fonts, HeadlineGradient, Spacing } from '@/constants/theme';
import {
  isAppleSignInAvailable,
  isGoogleConfigured,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/auth-social';

// Gradient text needs a native mask; the web preview falls back to solid blue.
const MaskedView =
  Platform.OS === 'web' ? null : require('@react-native-masked-view/masked-view').default;

// Brand-token ramps (design-language §1): sky→bright for heading words, the
// app-shell blue→deep for the CTA. No purple anywhere — blue-on-black system.
const HEADING_GRADIENT = HeadlineGradient;
const CTA_GRADIENT = CtaGradientShell;

/**
 * Brand lockup. `layout="row"` (default) puts the wordmark beside the mark for
 * the form screens; `layout="stack"` centres mark-over-wordmark for onboarding
 * moments. LIVE badge placement is identical in both.
 */
export function AuthBrandHeader({ layout = 'row' }: { layout?: 'row' | 'stack' }) {
  const c = useBrandColors();
  const stack = layout === 'stack';
  return (
    <View style={stack && styles.centered}>
      <View style={[styles.lockup, stack && styles.lockupStack]}>
        <View style={styles.markWrap}>
          <Image
            source={require('../../assets/images/brand-mark.png')}
            style={styles.mark}
            contentFit="contain"
          />
          <View style={[styles.liveBadge, { backgroundColor: c.live }]}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        </View>
        <Text style={[styles.wordmark, { color: c.text }, stack && styles.wordmarkStack]}>
          Any&All
        </Text>
      </View>
      <Text
        style={[styles.tagline, { color: c.textSecondary }, stack && styles.taglineStack]}
      >
        LIVE SHOPPING <Text style={{ color: c.primary }}>•</Text> INDIA
      </Text>
    </View>
  );
}

/** Heading metrics — `size` lets a screen set its own scale (the handle screen
 *  runs the gradient line slightly smaller than the white one). */
function headingStyle(size?: number) {
  return size
    ? [styles.heading, { fontSize: size, lineHeight: Math.round(size * 1.06) }]
    : [styles.heading];
}

/** Heading word rendered in the brand sky→bright blue gradient. */
export function GradientWord({ children, size }: { children: string; size?: number }) {
  const s = headingStyle(size);
  if (!MaskedView) return <Text style={[s, { color: Brand.blueElectric }]}>{children}</Text>;
  return (
    <MaskedView maskElement={<Text style={s}>{children}</Text>}>
      <LinearGradient colors={[...HEADING_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Text style={[s, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

export function HeadingText({ children, size }: { children: string; size?: number }) {
  return <Text style={[headingStyle(size), { color: '#FFFFFF' }]}>{children}</Text>;
}

export function GradientCTA({
  title,
  loadingTitle,
  loading,
  disabled,
  onPress,
  /** 'ring' draws the arrow inside a hairline circle (sign-up); 'plain' is the
   *  bare arrow used everywhere else. */
  arrow = 'plain',
}: {
  title: string;
  loadingTitle?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
  arrow?: 'plain' | 'ring';
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const SPREAD = 38;

  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {/* True bloom behind the CTA — a blurred, filled pill. shadowColor is
          ignored on Android, so the halo is rendered rather than cast. */}
      {box.width > 0 && (
        <Svg
          width={box.width + SPREAD * 2}
          height={box.height + SPREAD * 2}
          style={{ position: 'absolute', left: -SPREAD, top: -SPREAD }}
          pointerEvents="none"
        >
          <Defs>
            <Filter id="ctaGlowWide" x="-60%" y="-60%" width="220%" height="220%">
              <FeGaussianBlur stdDeviation={SPREAD * 0.34} />
            </Filter>
            <Filter id="ctaGlowTight" x="-50%" y="-50%" width="200%" height="200%">
              <FeGaussianBlur stdDeviation={SPREAD * 0.13} />
            </Filter>
          </Defs>
          <Rect
            x={SPREAD}
            y={SPREAD}
            width={box.width}
            height={box.height}
            rx={box.height / 2}
            ry={box.height / 2}
            fill={Brand.blueBright}
            opacity={0.45}
            filter="url(#ctaGlowWide)"
          />
        </Svg>
      )}
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        style={({ pressed }) => [
          styles.ctaWrap,
          { opacity: disabled ? 0.55 : pressed || loading ? 0.85 : 1 },
        ]}
      >
      <LinearGradient
        colors={[...CTA_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>{loading ? (loadingTitle ?? title) : title}</Text>
        {arrow === 'ring' ? (
          <View style={styles.ctaArrowRing}>
            <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
          </View>
        ) : (
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

/**
 * Google / Apple continue buttons with the shared flows. The parent only
 * handles outcomes: MFA challenge, error text, and the busy flag.
 */
export function SocialAuthButtons({
  busy,
  setBusy,
  onError,
  onMfaRequired,
  /** 'compact' uses short labels ("Google"/"Apple") on translucent glass —
   *  the paired look; 'full' spells out "Continue with …". */
  variant = 'full',
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onError: (message: string) => void;
  onMfaRequired: () => void;
  variant?: 'full' | 'compact';
}) {
  const c = useBrandColors();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [active, setActive] = useState<null | 'google' | 'apple'>(null);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => {});
  }, []);

  async function run(provider: 'google' | 'apple') {
    if (busy) return;
    setActive(provider);
    setBusy(true);
    try {
      // Note: a first-time social account has no @handle (register()'s form
      // never ran). SessionProvider detects that on auth-ready and routes to
      // /claim-username — one authority for fresh sign-ins, cold starts and
      // accounts created before the claim step existed.
      if (provider === 'google') await signInWithGoogle();
      else await signInWithApple();
    } catch (err: any) {
      if (err?.code === 'MFA_REQUIRED') onMfaRequired();
      else onError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      setActive(null);
      setBusy(false);
    }
  }

  const compact = variant === 'compact';
  const fill = compact ? 'rgba(12,18,42,0.46)' : c.backgroundElement;
  const stroke = compact ? 'rgba(190,210,255,0.34)' : c.border;
  // Compact + single provider (Android, where Apple has no native SDK): centre
  // the lone button at a sensible width instead of stretching it edge to edge.
  const soloCompact = compact && !appleAvailable;

  return (
    <>
      <View
        style={[
          styles.socialRow,
          !appleAvailable && !compact && styles.socialColumn,
          soloCompact && styles.socialSolo,
        ]}
      >
        <Pressable
          onPress={() => run('google')}
          disabled={busy || !isGoogleConfigured}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          style={({ pressed }) => [
            styles.socialBtn,
            compact && styles.socialBtnCompact,
            {
              backgroundColor: fill,
              borderColor: stroke,
              opacity: !isGoogleConfigured ? 0.45 : pressed || busy ? 0.8 : 1,
            },
          ]}
        >
          <GoogleIcon size={compact ? 22 : 18} />
          <Text style={[styles.socialText, { color: c.text }]}>
            {active === 'google' ? 'Connecting…' : compact ? 'Google' : 'Continue with Google'}
          </Text>
        </Pressable>

        {appleAvailable && (
          <Pressable
            onPress={() => run('apple')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
            style={({ pressed }) => [
              styles.socialBtn,
              compact && styles.socialBtnCompact,
              {
                backgroundColor: fill,
                borderColor: stroke,
                opacity: pressed || busy ? 0.8 : 1,
              },
            ]}
          >
            <AppleIcon size={compact ? 23 : 19} />
            <Text style={[styles.socialText, { color: c.text }]}>
              {active === 'apple' ? 'Connecting…' : compact ? 'Apple' : 'Continue with Apple'}
            </Text>
          </Pressable>
        )}
      </View>
      {!isGoogleConfigured && (
        <Text style={[styles.configNote, { color: c.textFaint }]}>
          Google sign-in will activate once it's configured for this build.
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center' },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  lockupStack: { flexDirection: 'column', gap: Spacing.one },
  wordmarkStack: { marginLeft: 0, fontSize: 30 },
  taglineStack: { textAlign: 'center', marginTop: Spacing.two },
  markWrap: { width: 52, height: 52 },
  mark: { width: 52, height: 52 },
  liveBadge: {
    position: 'absolute',
    top: -4,
    right: -14,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: { color: '#FFFFFF', fontFamily: Fonts.sansBold, fontSize: 9, letterSpacing: 0.5 },
  wordmark: { fontSize: 26, fontFamily: Fonts.sansBold, marginLeft: 6 },
  tagline: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 3,
    marginTop: Spacing.one,
  },
  // Archivo display voice (design-language §2). The site's face runs wdth 122,
  // which static instances lack — the tighter letterSpacing compensates.
  heading: {
    fontSize: 44,
    lineHeight: 47,
    fontFamily: Fonts.display,
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  ctaWrap: {
    borderRadius: 999,
    overflow: 'hidden',
    // Lit edge, matching the glowing CTA in the reference.
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + 2,
    height: 44,
  },
  ctaText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.uiBold },
  ctaArrowRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.2,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialRow: { flexDirection: 'row', gap: Spacing.two + Spacing.one },
  socialColumn: { flexDirection: 'column' },
  socialBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
  },
  socialBtnCompact: {
    borderRadius: 999,
    paddingVertical: 0,
    height: 42, // marginally under the 44dp guideline, at your direction
    minHeight: 42,
  },
  socialSolo: { justifyContent: 'center', alignSelf: 'center', width: '62%', maxWidth: 260 },
  socialText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  configNote: {
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginTop: -Spacing.one,
  },
});
