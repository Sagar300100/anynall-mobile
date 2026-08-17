// Launch splash — Stage 2 of the two-stage boot.
//
// This is an OVERLAY, never a route: it is not registered with expo-router, has
// no controls, no text of its own, and cannot be navigated to or back to. It
// simply sits above the app until initialisation finishes, then fades out and
// unmounts for good.
//
// Stage 1 is the native splash (app.json → expo-splash-screen). NOTE: on
// Android 12+ the OS owns the launch screen — it renders a solid colour plus a
// centred icon and ignores full-bleed images, so stage 1 cannot carry the
// gradient. It's therefore configured as the same logo at the same on-screen
// size (150dp ≈ the logo's size in the plate below) over the plate's darkest
// tone, so the only change at handover is the centre glow fading up.
//
// We hold the native splash until THIS component has actually laid out, so
// there's no white/black flash and no logo jump between the two.
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

/** Minimum time on screen so a fast boot doesn't flash the brand. */
const MIN_VISIBLE_MS = 900;
const FADE_MS = 250;
/** Hard ceiling: initialisation must never be able to strand the user here. */
const MAX_WAIT_MS = 6000;

export function SplashGate({ ready }: { ready: boolean }) {
  const [mounted, setMounted] = useState(true);
  const fade = useRef(new Animated.Value(1)).current;
  const startedAt = useRef(Date.now());
  const [timedOut, setTimedOut] = useState(false);

  // No entrance animation: this stage must be pixel-identical to the native
  // splash it replaces, so anything that moves would betray the handover.

  // Failsafe — if something in init never resolves, leave anyway.
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  // Hand the screen over from the native splash only once this overlay has
  // laid out — otherwise there's a blank frame between the two stages.
  const handleLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready && !timedOut) return;
    const elapsed = Date.now() - startedAt.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const t = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }, wait);
    return () => clearTimeout(t);
  }, [ready, timedOut, fade]);

  if (!mounted) return null;

  return (
    <Animated.View
      style={[styles.root, { opacity: fade }]}
      onLayout={handleLayout}
      // Purely presentational and non-interactive.
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* The same composited plate the native stage draws, with the same
          `cover` scaling — so stage 1 → stage 2 is visually a no-op rather
          than a second, different-looking splash. */}
      <Image
        source={require('../../assets/images/splash-full.png')}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#040711', // matches the native splash's backgroundColor
    zIndex: 9999,
  },
});
