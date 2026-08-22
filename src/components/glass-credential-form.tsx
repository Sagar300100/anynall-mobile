// One unified glass card holding both credential rows, split by a hairline.
// Fixed 62dp rows (124dp total) so the card stays compact, with an opaque
// enough fill that input text reads as active rather than disabled.
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useState } from 'react';
import Svg, { Defs, FeGaussianBlur, Filter, Rect } from 'react-native-svg';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';

// Frosted glass: a dark blue base for legibility, a white sheen on top so the
// panel catches light from the nebula, and a bright hairline edge.
// Lighter than the sky so the pills clearly sit *on* the nebula — the earlier
// near-black fill made them disappear into the background.
// Dark and genuinely translucent: the sky reads *through* the panel. A lighter
// fill turned these into milky grey slabs.
export const GLASS_FILL = 'rgba(12,18,42,0.46)';
export const GLASS_SHEEN = 'rgba(255,255,255,0.045)';
export const GLASS_STROKE = 'rgba(190,210,255,0.34)';
const PLACEHOLDER = 'rgba(226,234,255,0.72)';
/** How far the bloom reaches beyond the panel edge. */
const GLOW_SPREAD = 34;
// 52dp keeps a comfortable tap target (the 44dp minimum plus breathing room)
// while still reading compact — the same height Instagram/Revolut use.
const ROW_H = 44;
/** Fully rounded input pills, matching the reference. */
export const PILL_R = 22;

/**
 * Frosted panel with a **lit gradient edge** — a cyan→ice-blue rim (the
 * reference's lavender tone is off-limits: blue-on-black only). Built as a
 * 1.5px gradient underlay showing through around an
 * inset blurred core (a plain borderColor can only be one flat colour), plus
 * a soft outer halo so the panel glows against the nebula.
 */
export function GlassPanel({
  children,
  radius = 18,
  style,
}: {
  children: React.ReactNode;
  radius?: number;
  style?: object;
}) {
  const RIM = 1;
  const [box, setBox] = useState({ width: 0, height: 0 });
  const core =
    Platform.OS === 'web' ? (
      <View
        style={[
          styles.core,
          { borderRadius: radius - RIM, backgroundColor: GLASS_FILL, margin: RIM },
        ]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: GLASS_SHEEN }]} />
        {children}
      </View>
    ) : (
      <BlurView
        intensity={22}
        tint="dark"
        style={[styles.core, { borderRadius: radius - RIM, margin: RIM }]}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: GLASS_FILL }]} />
        {/* Top-down sheen: the highlight that makes it read as glass, not paint */}
        <LinearGradient
          colors={[GLASS_SHEEN, 'rgba(255,255,255,0.015)']}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </BlurView>
    );

  return (
    <View style={style} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {/* True bloom: a blurred stroke behind the panel. Android ignores
          shadowColor (elevation only casts a grey system shadow), and stacked
          rings read as discrete outlines — an SVG Gaussian blur is the only
          way to get a smooth halo on both platforms. */}
      {box.width > 0 && (
        <Svg
          width={box.width + GLOW_SPREAD * 2}
          height={box.height + GLOW_SPREAD * 2}
          style={{ position: 'absolute', left: -GLOW_SPREAD, top: -GLOW_SPREAD }}
          pointerEvents="none"
        >
          <Defs>
            <Filter id="panelGlowWide" x="-60%" y="-60%" width="220%" height="220%">
              <FeGaussianBlur stdDeviation={GLOW_SPREAD * 0.34} />
            </Filter>
            <Filter id="panelGlowTight" x="-50%" y="-50%" width="200%" height="200%">
              <FeGaussianBlur stdDeviation={GLOW_SPREAD * 0.12} />
            </Filter>
          </Defs>
          <Rect
            x={GLOW_SPREAD}
            y={GLOW_SPREAD}
            width={box.width}
            height={box.height}
            rx={radius}
            ry={radius}
            fill="none"
            stroke="#9BE0FF"
            strokeWidth={3}
            opacity={0.55}
            filter="url(#panelGlowWide)"
          />
        </Svg>
      )}

      {/* Luminous hairline — bright enough to catch light, still a rim not a
          neon tube. */}
      <LinearGradient
        colors={['rgba(236,248,255,0.72)', 'rgba(200,214,255,0.42)', 'rgba(220,238,255,0.66)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius }}
      >
        {core}
      </LinearGradient>
    </View>
  );
}

type RowProps = TextInputProps & {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: React.ReactNode;
};

const Row = forwardRef<TextInput, RowProps>(function Row(
  { icon, label, trailing, onFocus, onBlur, style, ...props },
  ref
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.row}>
      {/* Auth focus accent (design-language §6.4). */}
      <Ionicons
        name={icon}
        size={19}
        color={focused ? Brand.authAccent : 'rgba(150,180,240,0.85)'}
      />
      <TextInput
        ref={ref}
        placeholderTextColor={PLACEHOLDER}
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, style]}
        {...props}
      />
      {trailing}
    </View>
  );
});

export interface CredentialFormProps {
  email: string;
  password: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  showPassword: boolean;
  onTogglePassword: () => void;
  onSubmit: () => void;
  passwordRef: React.RefObject<TextInput | null>;
  error?: string | null;
}

export function GlassCredentialForm({
  email,
  password,
  onEmail,
  onPassword,
  showPassword,
  onTogglePassword,
  onSubmit,
  passwordRef,
  error,
}: CredentialFormProps) {
  const c = useBrandColors();
  return (
    <View>
      {/* The warm dust either side of these pills lives in the sky plate
          (scripts/generate-cosmic-bg.mjs, keyed to UI.form) so it reads as one
          continuous scene showing through the glass — not a glow layered on
          the component. */}

      {/* Two separate pills, as in the approved reference — not one card. */}
      <GlassPanel radius={PILL_R}>
        <Row
          icon="mail-outline"
          label="Email address"
          value={email}
          onChangeText={onEmail}
          placeholder="Email address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </GlassPanel>
      <View style={{ height: 6 }} />
      <GlassPanel radius={PILL_R}>
        <Row
          ref={passwordRef}
          icon="lock-closed-outline"
          label="Password"
          value={password}
          onChangeText={onPassword}
          placeholder="Password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          trailing={
            <Pressable
              onPress={onTogglePassword}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="rgba(190,208,245,0.85)"
              />
            </Pressable>
          }
        />
      </GlassPanel>
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: c.danger }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Soft outer halo — the panel reads as lit rather than cut out.
  core: { overflow: 'hidden' },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three + 4,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: Fonts.sans,
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  error: { fontSize: 13, fontFamily: Fonts.sansMedium, marginTop: Spacing.two },
});
