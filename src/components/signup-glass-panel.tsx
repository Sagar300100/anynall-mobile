// "New to Any&All?" panel — a compact 92dp glass strip with a small
// person-add disc overlapping its top edge by ~14dp (not floating free), a
// faint curved-line texture inside, and a circular arrow affordance.
// The whole strip is one accessible button.
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';

import { GlassPanel, GLASS_STROKE } from '@/components/glass-credential-form';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

const DISC = 33;

export function SignupGlassPanel({ onPress }: { onPress: () => void }) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New to Any&All? Create an account"
      style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.85 : 1 }]}
    >
      {/* Avatar disc overlapping the panel's top edge: a dark translucent
          circle with a lavender ring and a small "+" badge, per the close-up
          reference — not a solid gradient blob. */}
      <View style={styles.discWrap}>
        <View style={[styles.disc, { borderColor: 'rgba(190,170,255,0.85)' }]}>
          <Ionicons name="person-outline" size={22} color="#C9BFFF" />
        </View>
        <View style={[styles.plus, { borderColor: 'rgba(190,170,255,0.85)' }]}>
          <Ionicons name="add" size={12} color="#E4DDFF" />
        </View>
      </View>

      <GlassPanel radius={36}>
        {/* Faint curved-line texture */}
        <Svg width="100%" height={54} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <SvgLinearGradient id="curve" x1="0" y1="1" x2="1" y2="0">
              <Stop offset="0" stopColor="#8B5CF6" stopOpacity="0" />
              <Stop offset="0.35" stopColor="#C4B5FD" stopOpacity="0.42" />
              <Stop offset="0.65" stopColor="#A78BFA" stopOpacity="0.38" />
              <Stop offset="1" stopColor="#4DB8FF" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>
          {/* Meteor streaks sweeping up from the lower-left, as in the
              reference close-up — long fine diagonals, not horizontal arcs. */}
          {[
            { d: 'M -10 96 L 128 8', w: 1, o: 0.85 },
            { d: 'M 6 100 L 150 14', w: 0.8, o: 0.65 },
            { d: 'M 24 104 L 172 20', w: 0.7, o: 0.5 },
            { d: 'M -16 80 L 104 4', w: 0.7, o: 0.55 },
            { d: 'M 44 106 L 196 28', w: 0.6, o: 0.4 },
            { d: 'M 66 108 L 214 38', w: 0.6, o: 0.32 },
          ].map((s) => (
            <Path
              key={s.d}
              d={s.d}
              stroke="url(#curve)"
              strokeWidth={s.w}
              opacity={s.o}
              fill="none"
            />
          ))}
        </Svg>

        <View style={styles.body}>
          <View style={styles.text}>
            <Text style={[styles.title, { color: c.text }]}>New to Any&All?</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>Create an account</Text>
          </View>
          <View style={[styles.arrow, { borderColor: GLASS_STROKE }]}>
            <Ionicons name="chevron-forward" size={18} color={c.text} />
          </View>
        </View>

        {/* Small sparkle accent, lower-right — as in the reference */}
        <View style={styles.sparkle} pointerEvents="none">
          <Ionicons name="sparkles" size={14} color="rgba(196,181,253,0.75)" />
        </View>
      </GlassPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: DISC / 2 },
  discWrap: { position: 'absolute', top: 0, alignSelf: 'center', zIndex: 2 },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 1.5,
    backgroundColor: 'rgba(24,26,58,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    position: 'absolute',
    right: -2,
    bottom: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.2,
    backgroundColor: 'rgba(24,26,58,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    // Clears the avatar disc overlapping the top edge.
    paddingTop: Spacing.three,
  },
  text: { flex: 1, alignItems: 'center', gap: 1 },
  title: { fontSize: 12.5, fontFamily: Fonts.sansSemiBold },
  sub: { fontSize: 10.5, fontFamily: Fonts.sans },
  arrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: { position: 'absolute', right: 18, bottom: 12 },
});
