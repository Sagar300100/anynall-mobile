// FadeUp — the signature entrance (design-language §4): opacity 0→1 +
// translateY 30→0 over 800ms ease.reveal, delayed index×150ms. Wrap each
// staggered sibling:
//
//   <FadeUp index={0}>…</FadeUp>
//   <FadeUp index={1}>…</FadeUp>
//
// Runs ONCE on mount — re-renders never re-trigger it (the animated value is
// a ref and the effect closes over stable inputs). Reduce-motion lands at the
// resting state instantly.
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { dur, ease, stagger } from '@/lib/motion';

export function FadeUp({
  index = 0,
  delay,
  style,
  children,
}: {
  /** Position in the stagger run — delay defaults to index × 150ms. */
  index?: number;
  /** Explicit delay in ms; overrides `index`. */
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  // Lazy state, not a ref: stable across renders AND clean under the strict
  // react-hooks/refs rule (reading a ref's .current during render is flagged).
  const [progress] = useState(() => new Animated.Value(0));
  // Captured once so a changed prop on a later render can't re-time a run
  // that already happened.
  const [delayMs] = useState(() => delay ?? index * stagger.text);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) return progress.setValue(1);
        Animated.timing(progress, {
          toValue: 1,
          duration: dur.fadeUp,
          delay: delayMs,
          easing: ease.reveal,
          useNativeDriver: true,
        }).start();
      })
      // Query failed → land at rest, never hide content.
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress, delayMs]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [30, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
