// Guest Profile — the logged-out state of the Profile tab, built to the
// approved reference mock: layered account mark (offset crescent, dot grid,
// violet sparkle, orbit arc with satellite dots), two-line heading, gradient
// Sign in, "or" divider, blue-outlined Create an account, tinted icon-circle
// benefit rows, and a faint skyline behind the footer. No fake user data.
// The signed-in page lives in (app)/profile.tsx and is untouched.
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, RadialGradient, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';

import { openSite, ProfileFooter } from '@/components/profile-footer';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const VIOLET = '#8B7CF6';
const GREEN = '#34D399';

/**
 * Account mark, per the mock: a big navy disc with a white person outline,
 * a darker offset crescent behind its right edge, a dot grid upper-left, a
 * violet four-point sparkle lower-left, and a thin orbit arc on the right
 * carrying two blue satellites and a violet one at its tail.
 */
function AccountMark() {
  // Canvas 240×210; disc centred at (120,100), r=58; orbit r=74.
  const dots: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      dots.push(`M${44 + col * 9},${26 + row * 9}`);
    }
  }
  return (
    <View style={styles.markWrap}>
      {/* Same 240×210 geometry, uniformly scaled down to fit the whole page
          above the fold on a 360×800 device (mock fits on one screen). */}
      <Svg width={206} height={180} viewBox="0 0 240 210">
        <Defs>
          <RadialGradient id="disc" cx="38%" cy="30%" r="80%">
            <Stop offset="0%" stopColor="#1B2447" />
            <Stop offset="100%" stopColor="#0B1028" />
          </RadialGradient>
          <SvgLinearGradient id="orbit" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#4A8FE5" stopOpacity="0.9" />
            <Stop offset="100%" stopColor={VIOLET} stopOpacity="0.9" />
          </SvgLinearGradient>
        </Defs>

        {/* Offset crescent behind the right edge of the disc. */}
        <Circle cx={138} cy={104} r={58} fill="#070C20" />
        {/* Main disc. */}
        <Circle cx={120} cy={100} r={58} fill="url(#disc)" />

        {/* Dot grid, upper-left. */}
        {dots.map((d, i) => (
          <Path key={i} d={`${d} a1.6,1.6 0 1,0 0.01,0`} fill="#9FB4D8" opacity={0.35} />
        ))}

        {/* Orbit arc down the right side + satellites. */}
        <Path d="M139,29 A74,74 0 0 1 113,174" stroke="url(#orbit)" strokeWidth={1.5} fill="none" opacity={0.85} />
        <Circle cx={187} cy={75} r={4} fill="#4A8FE5" />
        <Circle cx={176} cy={148} r={3.2} fill="#6FA5EC" />
        <Circle cx={113} cy={174} r={5} fill={VIOLET} />

        {/* Four-point sparkle, lower-left. */}
        <Path
          d="M62,142 C64,149 66,151 73,153 C66,155 64,157 62,164 C60,157 58,155 51,153 C58,151 60,149 62,142 Z"
          fill={VIOLET}
        />
      </Svg>
      <View style={styles.markIcon} pointerEvents="none">
        <Ionicons name="person-outline" size={46} color="#F2F6FF" />
      </View>
    </View>
  );
}

/** Faint line-art skyline pinned behind the footer, per the mock. */
function Skyline() {
  return (
    <View style={styles.skyline} pointerEvents="none">
      <Svg width="100%" height={120} viewBox="0 0 360 120" preserveAspectRatio="xMidYMax slice">
        <Path
          d="M14,120 V84 H28 V120 M18,92 H24 M18,100 H24
             M36,120 V72 M52,120 V72 M36,72 Q44,58 52,72 M44,58 V50 M41,53 H47
             M60,120 V92 H82 V120 M65,99 H77 M65,107 H77
             M278,120 V100 H296 V120
             M304,120 V82 Q314,64 324,82 V120 M309,120 V88 Q314,79 319,88 V120
             M332,120 V94 M356,120 V94 M332,94 Q344,74 356,94 M344,74 V65 M340,69 H348"
          stroke="#5B79AC"
          strokeWidth={1.2}
          fill="none"
          opacity={0.32}
        />
      </Svg>
    </View>
  );
}

function BenefitRow({
  icon,
  tint,
  tintBg,
  label,
  support,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  tintBg: string;
  label: string;
  support: string;
  onPress: () => void;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={support}
      style={({ pressed }) => [styles.benefitRow, pressed && { backgroundColor: 'rgba(120,150,210,0.07)' }]}
    >
      <View style={[styles.benefitIcon, { backgroundColor: tintBg }]}>
        <Ionicons name={icon} size={22} color={tint} />
      </View>
      <View style={styles.benefitText}>
        <Text style={[styles.benefitLabel, { color: c.text }]}>{label}</Text>
        <Text style={[styles.benefitSupport, { color: c.textSecondary }]} numberOfLines={2}>
          {support}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={19} color={c.textFaint} />
    </Pressable>
  );
}

export function GuestProfileScreen() {
  const c = useBrandColors();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <Skyline />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Settings stays reachable while signed out (general app settings). */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={6}
            style={({ pressed }) => [styles.settingsBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="settings-outline" size={20} color="#DCE6F7" />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <AccountMark />
          <Text style={[styles.heading, { color: c.text }]}>Your account{'\n'}is waiting</Text>
          <Text style={[styles.support, { color: c.textSecondary }]}>
            Sign in to access your orders, delivery details and seller conversations.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.push('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
          >
            <LinearGradient
              colors={['#3D7BF7', '#8058F8']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryText}>Sign in</Text>
              <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>

          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: 'rgba(120,150,210,0.20)' }]} />
            <Text style={[styles.orText, { color: c.textFaint }]}>or</Text>
            <View style={[styles.orLine, { backgroundColor: 'rgba(120,150,210,0.20)' }]} />
          </View>

          <Pressable
            onPress={() => router.push('/sign-up')}
            accessibilityRole="button"
            accessibilityLabel="Create an account"
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: 'rgba(74,143,229,0.55)',
                backgroundColor: pressed ? 'rgba(74,143,229,0.10)' : 'transparent',
              },
            ]}
          >
            <Ionicons name="person-add-outline" size={19} color={c.primary} />
            <Text style={[styles.secondaryText, { color: c.primary }]}>Create an account</Text>
          </Pressable>
        </View>

        {/* What an account is for — every row opens something real. */}
        <View style={[styles.benefits, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
          <BenefitRow
            icon="pricetag-outline"
            tint={c.primary}
            tintBg="rgba(74,143,229,0.13)"
            label="Live shopping & auctions"
            support="Discover, bid and buy in real time"
            onPress={() => router.push('/')}
          />
          <View style={[styles.benefitDivider, { backgroundColor: c.border }]} />
          <BenefitRow
            icon="shield-outline"
            tint={GREEN}
            tintBg="rgba(52,211,153,0.11)"
            label="Buyer protection"
            support="Secure payments and easy refunds"
            onPress={() => openSite('/how-it-works')}
          />
          <View style={[styles.benefitDivider, { backgroundColor: c.border }]} />
          <BenefitRow
            icon="chatbubble-outline"
            tint={VIOLET}
            tintBg="rgba(139,124,246,0.13)"
            label="Seller conversations"
            support="Chat with sellers and get updates"
            onPress={() => router.push({ pathname: '/sign-in', params: { reason: 'inbox' } })}
          />
        </View>

        <ProfileFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: Spacing.one },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  hero: { alignItems: 'center', marginTop: -Spacing.three },
  markWrap: { width: 206, height: 180, alignItems: 'center', justifyContent: 'center' },
  markIcon: {
    position: 'absolute',
    // Disc centre (120,100) on the 240×210 viewBox, scaled by 206/240.
    top: 100 * (180 / 210) - 23,
    left: 120 * (206 / 240) - 23,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 27,
    lineHeight: 33,
    fontFamily: Fonts.sansSemiBold,
    textAlign: 'center',
    marginTop: Spacing.one,
  },
  support: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 310,
    marginTop: Spacing.one + 2,
  },

  actions: { marginTop: Spacing.three, gap: Spacing.two },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 50,
    borderRadius: 16,
  },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontFamily: Fonts.sansSemiBold },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontSize: 13, fontFamily: Fonts.sans },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
  },
  secondaryText: { fontSize: 16, fontFamily: Fonts.sansMedium },

  benefits: {
    marginTop: Spacing.three,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    minHeight: 58,
  },
  benefitIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, gap: 1 },
  benefitLabel: { fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  benefitSupport: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },
  // Inset so the line starts where the titles start (pad 16 + circle 42 + gap 14).
  benefitDivider: { height: StyleSheet.hairlineWidth, marginLeft: 72 },

  skyline: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
