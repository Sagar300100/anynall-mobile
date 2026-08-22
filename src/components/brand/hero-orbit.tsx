// HeroOrbit — the home screen crown (design-language §5). A native
// recreation of the site hero, cheap by design:
//
//   • Globe: ~220 fibonacci-sphere points, computed ONCE at module scope and
//     rendered ONCE as a memo'd SVG — the only animation is a plain-Animated
//     rotate loop (90s linear) + scale breathe ±2% (4s ease-in-out) on the
//     wrapping view. Native driver, AppState-paused, reduce-motion static.
//   • Orbit: the 6 product cutouts ride an ellipse driven by ONE Reanimated
//     shared-value clock (70s/rev, UI thread only). Per-image style:
//     θ = clock + phase, x = sin·Rx, y = cos·Ry·0.35, scale/opacity by depth.
//     TWO mounted copies of every image — one layer behind the globe, one in
//     front — with animated opacity gating (a copy is opacity 0 whenever the
//     item is on the layer's wrong side), so depth sorting never re-parents.
//   • Type block: live eyebrow + Archivo display pair (one GradientText
//     accent line) + mistSoft tagline.
//
// The whole component is memo'd and all motion lives on the UI/native side,
// so the home ScrollView never re-renders because of it.
import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import {
  Animated as RNAnimated,
  AppState,
  Easing as RNEasing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
} from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Eyebrow } from '@/components/brand/eyebrow';
import { FadeUp } from '@/components/brand/fade-up';
import { GradientText } from '@/components/brand/gradient-text';
import { Brand, Fonts } from '@/constants/theme';
import { loop as motionLoop, useReduceMotion } from '@/lib/motion';

const TWO_PI = Math.PI * 2;

// ── Globe points: computed once, at module scope ────────────────────────────
//
// Golden-angle (fibonacci) sphere, projected straight down the z axis:
// x/y land on the disc, z becomes depth → opacity 0.15–0.9 and radius 1–3.
// 82% white / 18% #E8DFF5, deterministically (i % 50 < 9 ⇒ exactly 18%).
const GLOBE_POINTS = (() => {
  const N = 220;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const pts: { cx: number; cy: number; r: number; opacity: number; color: string }[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * i) / (N - 1); // -1..1 top to bottom
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    const x = Math.cos(theta) * ring;
    const z = Math.sin(theta) * ring;
    const depth = (z + 1) / 2; // 0 = far side, 1 = near side
    pts.push({
      cx: x * 100,
      cy: y * 100,
      r: 1 + depth * 2,
      opacity: 0.15 + depth * 0.75,
      color: i % 50 < 9 ? '#E8DFF5' : '#FFFFFF',
    });
  }
  return pts;
})();

/** The 6 hero cutouts (assets/hero). Sizes are the ~72–96px front sizes. */
const HERO_ITEMS: readonly { key: string; size: number; source: ImageSourcePropType }[] = [
  { key: 'headphones', size: 92, source: require('../../../assets/hero/headphones.png') },
  { key: 'apple-watch', size: 74, source: require('../../../assets/hero/apple-watch.png') },
  { key: 'black-nike', size: 96, source: require('../../../assets/hero/black-nike.png') },
  { key: 'perfume', size: 78, source: require('../../../assets/hero/perfume.png') },
  { key: 'game-controllers', size: 88, source: require('../../../assets/hero/game-controllers.png') },
  { key: 'grey-cap', size: 82, source: require('../../../assets/hero/grey-cap.png') },
];

// ── Globe: static dots, rendered once ───────────────────────────────────────
const GlobeDots = memo(function GlobeDots({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="-110 -110 220 220">
      {GLOBE_POINTS.map((p, i) => (
        <Circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.color} opacity={p.opacity} />
      ))}
    </Svg>
  );
});

// ── Globe spin + breathe (plain Animated, native driver) ────────────────────
const GlobeSpin = memo(function GlobeSpin({ size }: { size: number }) {
  // Lazy state, not a ref — stable identity, clean under react-hooks/refs.
  const [spin] = useState(() => new RNAnimated.Value(0));
  const [breathe] = useState(() => new RNAnimated.Value(0.5));
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      // Resting state: upright, scale 1 (breathe midpoint).
      spin.setValue(0);
      breathe.setValue(0.5);
      return;
    }
    const spinLoop = RNAnimated.loop(
      RNAnimated.timing(spin, {
        toValue: 1,
        duration: 90_000, // 90s/rev — §5's globe rotate
        easing: RNEasing.linear,
        useNativeDriver: true,
      })
    );
    // 4s full cycle: 0.98 ↔ 1.02 (±2% around rest).
    const breatheLoop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(breathe, {
          toValue: 1,
          duration: 2_000,
          easing: RNEasing.inOut(RNEasing.sin),
          useNativeDriver: true,
        }),
        RNAnimated.timing(breathe, {
          toValue: 0,
          duration: 2_000,
          easing: RNEasing.inOut(RNEasing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    const startAll = () => {
      // A restarted native-driver timing re-captures its fromValue at the
      // CURRENT (paused) position, so without a reset each resume shrinks the
      // sweep toward a frozen globe. The globe is rotationally uniform dots,
      // so snapping back to 0 before restarting is invisible. The breathe
      // sequence needs no reset: each cycle re-targets 1 then 0, so it
      // self-corrects from wherever it paused.
      spinLoop.stop();
      spin.setValue(0);
      spinLoop.start();
      breatheLoop.start();
    };
    const stopAll = () => {
      spinLoop.stop();
      breatheLoop.stop();
    };
    startAll();
    // Stopping on ANY non-active state includes iOS's transient 'inactive'
    // (notification shade, app switcher): the flicker is just a pause, and
    // the reset in startAll() makes every restart clean.
    const sub = AppState.addEventListener('change', (s) =>
      s === 'active' ? startAll() : stopAll()
    );
    return () => {
      stopAll();
      sub.remove();
    };
  }, [spin, breathe, reduceMotion]);

  return (
    <RNAnimated.View
      style={{
        width: size,
        height: size,
        transform: [
          {
            rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
          },
          {
            scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }),
          },
        ],
      }}
    >
      <GlobeDots size={size} />
    </RNAnimated.View>
  );
});

// ── One orbiting cutout, one layer ──────────────────────────────────────────
//
// Every item is mounted TWICE: a 'back' copy under the globe and a 'front'
// copy above it. The copy whose side doesn't match cos(θ) is gated to
// opacity 0 in the same worklet frame the other copy appears, so the item
// crosses the globe's edge without any re-parenting or z-index writes.
const OrbitItem = memo(function OrbitItem({
  clock,
  phase,
  rx,
  ry,
  size,
  source,
  front,
}: {
  clock: SharedValue<number>;
  phase: number;
  rx: number;
  ry: number;
  size: number;
  source: ImageSourcePropType;
  front: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const theta = clock.value + phase;
    const c = Math.cos(theta);
    const depth = (c + 1) / 2; // 0 back → 1 front
    const onFrontHalf = c > 0;
    const visible = front ? onFrontHalf : !onFrontHalf;
    return {
      opacity: visible ? 0.42 + 0.58 * depth : 0,
      transform: [
        { translateX: Math.sin(theta) * rx },
        { translateY: c * ry * 0.35 },
        { scale: 0.55 + 0.45 * depth },
      ],
    };
  });

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.orbitItem,
        { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 },
        animatedStyle,
      ]}
    >
      <Image source={source} style={styles.orbitImage} contentFit="contain" />
    </Reanimated.View>
  );
});

function OrbitLayer({
  clock,
  rx,
  ry,
  front,
}: {
  clock: SharedValue<number>;
  rx: number;
  ry: number;
  front: boolean;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {HERO_ITEMS.map((item, i) => (
        <OrbitItem
          key={item.key}
          clock={clock}
          phase={(i * TWO_PI) / HERO_ITEMS.length}
          rx={rx}
          ry={ry}
          size={item.size}
          source={item.source}
          front={front}
        />
      ))}
    </View>
  );
}

// ── HeroOrbit ───────────────────────────────────────────────────────────────
export const HeroOrbit = memo(function HeroOrbit({ height }: { height: number }) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  // THE clock: one shared value drives all 12 mounted copies on the UI
  // thread. Shared-value writes never re-render React.
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      // Static ring — items rest at their phase positions, no clock runs.
      cancelAnimation(clock);
      clock.value = 0;
      return;
    }
    const start = () => {
      cancelAnimation(clock);
      // Resume from wherever the ring was — θ only feeds sin/cos, so the
      // running window `from → from+2π` needs no normalisation downstream.
      const from = clock.value % TWO_PI;
      clock.value = from;
      clock.value = withRepeat(
        withTiming(from + TWO_PI, { duration: motionLoop.orbit, easing: ReEasing.linear }),
        -1,
        false
      );
    };
    start();
    const sub = AppState.addEventListener('change', (s) =>
      s === 'active' ? start() : cancelAnimation(clock)
    );
    return () => {
      sub.remove();
      cancelAnimation(clock);
    };
  }, [clock, reduceMotion]);

  // Geometry: globe in the upper ~60%, type block anchored to the bottom.
  const stageH = Math.round(height * 0.6);
  const globeSize = Math.round(Math.min(width * 0.72, stageH * 0.88));
  const rx = Math.round(Math.min(width * 0.4, width / 2 - 52));
  const ry = Math.round(globeSize * 0.92);
  const headlineSize = Math.min(40, Math.max(34, Math.round(width * 0.098)));

  return (
    <View style={{ height }}>
      <View style={[styles.stage, { height: stageH }]} pointerEvents="none">
        <View style={{ width: globeSize, height: globeSize }}>
          <OrbitLayer clock={clock} rx={rx} ry={ry} front={false} />
          <GlobeSpin size={globeSize} />
          <OrbitLayer clock={clock} rx={rx} ry={ry} front />
        </View>
      </View>

      <View style={styles.typeBlock} pointerEvents="box-none">
        <FadeUp index={0}>
          <Eyebrow live>Any seller · All India · Live</Eyebrow>
        </FadeUp>
        <FadeUp index={1}>
          <Text
            allowFontScaling={false}
            style={[
              styles.headline,
              { fontSize: headlineSize, lineHeight: Math.round(headlineSize * 1.02) },
            ]}
          >
            Live drops.
          </Text>
          <GradientText size={headlineSize}>Real sellers.</GradientText>
        </FadeUp>
        <FadeUp index={2}>
          <Text style={styles.tagline}>
            Bid, buy and chat in real time — live shows from sellers across India.
          </Text>
        </FadeUp>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitItem: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  orbitImage: { width: '100%', height: '100%' },
  typeBlock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 6,
    gap: 10,
  },
  headline: {
    color: Brand.text,
    fontFamily: Fonts.display,
    letterSpacing: -1,
  },
  tagline: {
    color: Brand.mistSoft,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
  },
});
