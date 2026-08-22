// PressScale — THE press feel (design-language §4): scale → 0.97 over 90ms on
// pressIn, release back over 220ms ease.settle. All new buttons wrap in this
// (GradientCTA already does). Accessibility + Pressable props pass through
// untouched; reduce-motion disables the scale entirely.
import { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { dur, ease, useReduceMotion } from '@/lib/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressScaleProps = Omit<PressableProps, 'style'> & {
  /** Static view styles for the pressable (function styles not supported —
   *  press feedback is the scale, not a restyle). */
  style?: StyleProp<ViewStyle>;
};

export function PressScale({ style, onPressIn, onPressOut, children, ...rest }: PressScaleProps) {
  // Lazy state, not a ref — stable identity, clean under react-hooks/refs.
  const [scale] = useState(() => new Animated.Value(1));
  const reduceMotion = useReduceMotion();

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (!reduceMotion) {
        Animated.timing(scale, {
          toValue: 0.97,
          duration: dur.press,
          easing: ease.settle,
          useNativeDriver: true,
        }).start();
      }
      onPressIn?.(e);
    },
    [scale, reduceMotion, onPressIn]
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (!reduceMotion) {
        Animated.timing(scale, {
          toValue: 1,
          duration: dur.release,
          easing: ease.settle,
          useNativeDriver: true,
        }).start();
      } else {
        scale.setValue(1);
      }
      onPressOut?.(e);
    },
    [scale, reduceMotion, onPressOut]
  );

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
