// Auth backdrop. The sky is a baked image (assets/images/auth-cosmos.png,
// produced by scripts/generate-cosmic-bg.mjs) because photographic cloud
// turbulence and a dense starfield can't be drawn convincingly with a handful
// of SVG gradients — that was the gap against the approved reference.
//
// On top of the plate: a slow drift (parallax of a few px), a soft centre lift
// so the form column reads brighter, and a vignette. Motion stops for
// reduced-motion and while the app is backgrounded.
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, {
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  Path,
  RadialGradient,
  Rect,
  Stop,
  LinearGradient as SvgLinearGradient,
} from 'react-native-svg';

// Light structure in the sky, as fractions of the viewport: long smooth arcs
// sweeping the edges, softer wisps threading the middle, and two short
// shooting-star streaks. Fixed paths — the sky is identical on every render.
type SkyLine = { d: (w: number, h: number) => string; width: number; o: number };

// The sweeping arcs and wisps are baked into the sky plate
// (scripts/generate-cosmic-bg.mjs) as soft-edged light bands — drawing them as
// SVG strokes here read as lines *over* the sky rather than light *in* it.
// Only the shooting streaks stay vector: they want a hard, bright core.

/**
 * Short shooting-star streaks, placed in empty sky only. An earlier pass put
 * one straight through the logo and another across the social row, which read
 * as scratches on the screen rather than distant light.
 */
const STREAKS: SkyLine[] = [
  { d: (w, h) => `M ${w * 0.16} ${h * 0.07} L ${w * 0.25} ${h * 0.115}`, width: 1.3, o: 0.85 },
  { d: (w, h) => `M ${w * 0.78} ${h * 0.86} L ${w * 0.86} ${h * 0.9}`, width: 1, o: 0.45 },
];

export function CosmicAuthBackground() {
  const { width, height } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => !cancelled && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 34000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 34000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    const appSub = AppState.addEventListener('change', (s) =>
      s === 'active' ? loop.start() : loop.stop()
    );
    return () => {
      loop.stop();
      appSub.remove();
    };
  }, [drift, reduceMotion]);

  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [-10, 10] });
  const translateY = drift.interpolate({ inputRange: [0, 1], outputRange: [7, -7] });
  // Sky lines breathe with the drift — a slow swell, never a strobe (and flat
  // when reduced-motion is on, since the same `drift` value is pinned).
  const skyGlow = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Slightly oversized so the drift never exposes an edge. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { transform: [{ translateX }, { translateY }, { scale: 1.06 }] },
        ]}
      >
        <Image
          source={require('../../assets/images/auth-cosmos.png')}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={300}
        />
      </Animated.View>

      {/* Centre lift + vignette: brightens the column the form sits in and
          settles the corners so nothing competes with the UI. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Blue-family lift (no purple — blue-on-black only): authAccent
              #2B7FFF and logoCore #185AB6 at the same alphas/luminance the
              old violet stops carried, so the composition reads unchanged. */}
          <RadialGradient id="lift" cx="50%" cy="26%" r="62%">
            <Stop offset="0" stopColor="#2B7FFF" stopOpacity="0.20" />
            <Stop offset="0.6" stopColor="#185AB6" stopOpacity="0.06" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="45%" r="75%">
            <Stop offset="0" stopColor="#03060F" stopOpacity="0" />
            <Stop offset="0.65" stopColor="#03060F" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#03060F" stopOpacity="0.62" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width={width} height={height} fill="url(#lift)" />
        <Rect x="0" y="0" width={width} height={height} fill="url(#vignette)" />
      </Svg>

      {/* Sky light: sweeping arcs, fine wisps and shooting streaks. Each line
          is drawn twice — a blurred bloom under a crisp core — so it glows
          like light rather than reading as a drawn stroke. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: skyGlow }]}>
        <Svg width={width} height={height}>
          <Defs>
            <Filter id="skyBloom" x="-60%" y="-60%" width="220%" height="220%">
              <FeGaussianBlur stdDeviation={5} />
            </Filter>
            {/* Tapers so a streak reads as motion, not a dash. */}
            <SvgLinearGradient id="streakInk" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <Stop offset="0.75" stopColor="#EAF7FF" stopOpacity="1" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.9" />
            </SvgLinearGradient>
          </Defs>

          {STREAKS.map((s, i) => {
            const d = s.d(width, height);
            return (
              <G key={`s${i}`} opacity={s.o}>
                <Path
                  d={d}
                  stroke="#CFEBFF"
                  strokeWidth={s.width * 4}
                  fill="none"
                  opacity={0.5}
                  filter="url(#skyBloom)"
                />
                <Path
                  d={d}
                  stroke="url(#streakInk)"
                  strokeWidth={s.width}
                  strokeLinecap="round"
                  fill="none"
                />
              </G>
            );
          })}
        </Svg>
      </Animated.View>
    </View>
  );
}
