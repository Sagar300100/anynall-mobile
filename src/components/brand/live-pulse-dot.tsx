// LivePulseDot — every live indicator's dot (design-language §4): opacity
// 1↔0.45 + scale 1↔0.85 on a 1400ms loop. Pauses while the app is
// backgrounded; reduce-motion renders it static at full presence. Memo'd so
// parent re-renders (chat, price ticks) never touch the loop.
import { memo, useEffect, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';

import { Brand } from '@/constants/theme';
import { loop as loopTokens, useReduceMotion } from '@/lib/motion';

export const LivePulseDot = memo(function LivePulseDot({
  color = Brand.live,
  size = 8,
}: {
  color?: string;
  size?: number;
}) {
  // Lazy state, not a ref — stable identity, clean under react-hooks/refs.
  const [pulse] = useState(() => new Animated.Value(0));
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      // Resting state = fully present (a dimmed dot would read as "off-air").
      pulse.setValue(0);
      return;
    }
    const half = loopTokens.pulse / 2;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: half,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: half,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    const sub = AppState.addEventListener('change', (s) =>
      s === 'active' ? anim.start() : anim.stop()
    );
    return () => {
      anim.stop();
      sub.remove();
    };
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        transform: [
          { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }) },
        ],
      }}
    />
  );
});
