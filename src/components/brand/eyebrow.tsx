// Eyebrow — the site's mono kicker (design-language §2): JetBrains Mono 11,
// UPPERCASE, letterSpacing 2.4, blueGlow. `live` prepends the pulsing dot:
//
//   <Eyebrow live>Any seller · All India · Live</Eyebrow>
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { LivePulseDot } from '@/components/brand/live-pulse-dot';
import { Brand, Fonts } from '@/constants/theme';

export function Eyebrow({
  children,
  live = false,
  color = Brand.blueGlow,
  style,
  textStyle,
}: {
  children: string;
  /** Leading LivePulseDot. */
  live?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      {live && <LivePulseDot size={7} />}
      <Text style={[styles.text, { color }, textStyle]}>{children.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 2.4,
  },
});
