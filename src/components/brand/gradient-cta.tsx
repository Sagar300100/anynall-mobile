// GradientCTA — the redesign's primary button (design-language §1/§3).
//
//   default ('shell'): 135° #1E6FFF → #0A4FD0, white Jakarta 700 15, radius
//   13, the blue glow shadow — app-shell actions.
//   variant 'room':    135° #1E6FFF → #4DB8FF, navy #04122B text, radius 9 —
//   bid/buy inside the live room.
//
// Press feel comes from PressScale. The shadow lives on the outer pressable
// (never on the overflow-hidden gradient, or iOS clips it).
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { PressScale } from '@/components/brand/press-scale';
import {
  Brand,
  CtaGradientRoom,
  CtaGradientShell,
  Fonts,
  Shadows,
} from '@/constants/theme';

export function GradientCTA({
  title,
  onPress,
  variant = 'shell',
  arrow = false,
  disabled = false,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  /** 'shell' (default) = app-shell blue→deep; 'room' = bid/buy blue→sky. */
  variant?: 'shell' | 'room';
  /** Trailing arrow-forward icon. */
  arrow?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const room = variant === 'room';
  const radius = room ? 9 : 13;
  const textColor = room ? Brand.navyText : '#FFFFFF';

  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      style={[
        { borderRadius: radius },
        // Elevation would paint a grey Android shadow under a translucent
        // press state; the blue glow is the shell CTA's signature, so it
        // stays — dimmed with the button when disabled.
        room ? null : Shadows.cta,
        disabled && styles.disabled,
        style,
      ]}
    >
      <LinearGradient
        colors={room ? [...CtaGradientRoom] : [...CtaGradientShell]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fill, { borderRadius: radius }]}
      >
        <Text style={[styles.label, { color: textColor }]}>{title}</Text>
        {arrow && <Ionicons name="arrow-forward" size={17} color={textColor} />}
      </LinearGradient>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  fill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 22,
    paddingVertical: 12,
    overflow: 'hidden',
  },
  label: {
    fontFamily: Fonts.uiBold,
    fontSize: 15,
  },
  disabled: { opacity: 0.55 },
});
