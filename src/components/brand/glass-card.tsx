// GlassCard — the two glass recipes (design-language §3), translucent fills
// with hairline borders. NO blur: RN has no backdrop-filter, and the site's
// recipes read correctly as plain gradient fills over PageAtmosphere.
//
//   'panel' — hero/section panel: 180° rgba(8,26,52,0.66) → rgba(4,12,30,0.72),
//             border rgba(77,184,255,0.16), radius 22.
//   'card'  — bento/photo card: white 5% fill, hairlineWhite border, radius 16.
//
// Emphasis (hover/selected) = raise the border alpha, never thicken it.
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { Brand } from '@/constants/theme';

const PANEL_FILL = ['rgba(8,26,52,0.66)', 'rgba(4,12,30,0.72)'] as const;
const PANEL_STROKE = 'rgba(77,184,255,0.16)';

export function GlassCard({
  variant = 'card',
  radius,
  style,
  children,
}: {
  variant?: 'panel' | 'card';
  /** Defaults per spec: panel 22, card 16. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  if (variant === 'panel') {
    const r = radius ?? 22;
    return (
      <LinearGradient
        colors={[...PANEL_FILL]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.base, { borderRadius: r, borderColor: PANEL_STROKE }, style]}
      >
        {children}
      </LinearGradient>
    );
  }
  const r = radius ?? 16;
  return (
    <View
      style={[
        styles.base,
        styles.card,
        { borderRadius: r, borderColor: Brand.hairlineWhite },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
});
