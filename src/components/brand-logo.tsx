// Any&All ribbon mark + LIVE badge. The asset is the official brand mark
// (assets/images/brand-mark.png, generated from
// public/assets/brand/any_all_A_mark_transparent.png) — never redrawn, never
// recoloured, aspect always preserved.
//
// The badge is anchored to the ribbon's own upper-right corner. The PNG has
// ~8% transparent padding, so the badge is inset from the image box to land a
// few dp off the ribbon edge rather than floating away from it.
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useBrandColors } from '@/components/ui/form';
import { Fonts } from '@/constants/theme';

export function BrandLogo({ size = 96 }: { size?: number }) {
  const c = useBrandColors();
  // The ribbon narrows to an apex at top-centre, so the image box's top-right
  // corner is empty — anchoring there left the badge floating in space.
  // These land it on the ribbon's own upper-right stroke.
  const badgeLeft = size * 0.66;
  const badgeTop = size * 0.05;

  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel="Any&All">
      {/* Luminous halo behind the ribbon — the mark reads as lit, as in the
          reference, without altering the artwork itself. */}
      <Svg
        width={size * 1.9}
        height={size * 1.9}
        style={{ position: 'absolute', left: -size * 0.45, top: -size * 0.45 }}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#B8E6FF" stopOpacity="0.88" />
            <Stop offset="0.26" stopColor="#66AEFF" stopOpacity="0.52" />
            <Stop offset="0.58" stopColor="#3570DC" stopOpacity="0.20" />
            <Stop offset="1" stopColor="#1B2A6B" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {/* Halo only. Earlier "light spill" ellipses rendered as grey bars
            slicing through the ribbon — an artifact, not a flare. */}
        <Circle cx={size * 0.95} cy={size * 0.95} r={size * 0.9} fill="url(#logoGlow)" />
      </Svg>
      <Image
        source={require('../../assets/images/brand-mark.png')}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
      <View
        style={[styles.badge, { backgroundColor: c.live, top: badgeTop, left: badgeLeft }]}
      >
        <Text style={styles.badgeText}>LIVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    borderRadius: 4,
    paddingHorizontal: 4.5,
    paddingVertical: 1,
  },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: Fonts.sansBold,
    fontSize: 8,
    letterSpacing: 0.3,
  },
});
