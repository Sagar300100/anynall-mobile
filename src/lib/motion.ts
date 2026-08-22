// Motion tokens — docs/design-language.md §4. Plain RN Animated only; the
// single Reanimated consumer is the hero orbit, which owns its own clock.
//
// Non-negotiable rules for every consumer:
//   • `useNativeDriver: true` everywhere — transform + opacity ONLY. Never
//     animate width/height/color/shadow props.
//   • Every loop pauses on AppState background AND respects reduce-motion
//     (land on the RESTING state, don't freeze mid-flight).
//   • Animated things live in isolated memo'd components (the LiveChat
//     pattern) so re-renders elsewhere never touch them.
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing, type EasingFunction } from 'react-native';

/** Easing curves. `settle` is THE site curve — presses, releases, stand-ups. */
export const ease: {
  readonly settle: EasingFunction;
  readonly reveal: EasingFunction;
  readonly exit: EasingFunction;
} = {
  settle: Easing.bezier(0.16, 0.84, 0.34, 1),
  reveal: Easing.bezier(0.25, 0.4, 0.25, 1), // entrance fades
  exit: Easing.out(Easing.exp),
};

/** Durations (ms). */
export const dur = {
  press: 90,
  fast: 160,
  release: 220,
  micro: 300,
  modal: 320,
  entrance: 500,
  fadeUp: 800,
  standUp: 950,
} as const;

/** Per-sibling stagger delays (ms). `tilesCap`: index caps at 5 for tiles. */
export const stagger = {
  words: 40,
  tiles: 80,
  tilesCap: 5,
  cards: 110,
  text: 150,
} as const;

/** Loop periods (ms). Desync float siblings inside 4500–6800. */
export const loop = {
  pulse: 1400,
  floatMin: 4500,
  floatMax: 6800,
  orbit: 70000,
} as const;

// ── Reduce-motion cache ──────────────────────────────────────────────────────
//
// ONE async query + ONE subscription for the whole app, seeded at module load.
// Entrance components (FadeUp, StandUp, the sign-in entrance) read this cache
// synchronously on mount so their animation starts on the very first frame —
// without it, every mount paid its own AccessibilityInfo round trip before
// anything moved. `null` only until the first query resolves (i.e. the first
// few ms of a cold start); callers fall back to the async query then.
let reducedMotionCache: boolean | null = null;

AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    // A change event may have landed first — never overwrite fresher data.
    if (reducedMotionCache === null) reducedMotionCache = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reducedMotionCache = v;
});

/** Cached reduce-motion flag: `boolean` once known, `null` before the first
 *  system query resolves. Kept fresh by the module-level subscription. */
export function getReducedMotionSync(): boolean | null {
  return reducedMotionCache;
}

/**
 * Live reduce-motion flag (the cosmic-background idiom): seeds from the
 * async system query, then tracks changes via subscription. Starts `false`
 * until the first query resolves — loops started before that must also check
 * the resolved value (the brand primitives all re-run their effect on change
 * and land on the resting state).
 */
export function useReduceMotion(): boolean {
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

  return reduceMotion;
}

// pressStyle guidance ────────────────────────────────────────────────────────
// Do NOT hand-roll press feedback with opacity or ad-hoc scales. Every
// pressable surface uses <PressScale> (components/brand/press-scale):
//   scale → 0.97 over dur.press (90ms) on pressIn,
//   back → 1 over dur.release (220ms) with ease.settle on pressOut,
//   native driver, no feedback when reduce-motion is on.
// Buttons that need the brand fill use <GradientCTA> (components/brand/
// gradient-cta), which already wraps PressScale.
