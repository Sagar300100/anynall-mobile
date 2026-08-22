// The app-shell ground (design-language §1) — replaces flat backgrounds on
// every non-live-room screen. Parent renders it FIRST inside a relatively
// positioned container, content on top:
//
//   <View style={{ flex: 1 }}>
//     <PageAtmosphere />
//     …content…
//   </View>
//
// STATIC by design: zero per-frame work, no props, memo'd — one linear base
// gradient plus three radial blooms, all fire-and-forget. The site's dot grid
// is deliberately skipped on mobile (cost > value at phone scale).
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Brand } from '@/constants/theme';

export const PageAtmosphere = memo(function PageAtmosphere() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Base: linear 165° ink950 → ink850 at 55% → ink950. */}
      <LinearGradient
        colors={[Brand.ink950, Brand.ink850, Brand.ink950]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.37, y: 0 }}
        end={{ x: 0.63, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Three radial blooms. Percentage-based geometry, so no measuring —
          the Svg stretches with the screen. Each rect is fully transparent
          past its gradient edge, so stacking them is free. */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="bloomTL" cx="12%" cy="8%" r="55%">
            <Stop offset="0" stopColor="#1E6FFF" stopOpacity={0.2} />
            <Stop offset="1" stopColor="#1E6FFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bloomTR" cx="88%" cy="14%" r="50%">
            <Stop offset="0" stopColor="#4DB8FF" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#4DB8FF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bloomB" cx="50%" cy="96%" r="60%">
            <Stop offset="0" stopColor="#1E6FFF" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#1E6FFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloomTL)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloomTR)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bloomB)" />
      </Svg>
    </View>
  );
});
