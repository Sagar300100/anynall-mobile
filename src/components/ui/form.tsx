// Shared UI primitives styled to the website's brand-v2 system: white
// primary buttons with navy text, ghost buttons with blue hairlines, dark
// panel inputs, mono uppercase eyebrows, serif display headings.
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { Brand, Colors, Fonts, Spacing } from '@/constants/theme';

// Site is dark-only navy; hook kept so screens don't care.
export function useBrandColors() {
  return Colors.dark;
}

/** Mono uppercase letter-spaced label — the site's .eyebrow (blueGlow, per
 *  design-language §2). New screens prefer components/brand/eyebrow, which
 *  adds the live pulse dot. */
export function Eyebrow({ children, style }: { children: string; style?: TextStyle }) {
  return (
    <Text style={[styles.eyebrow, { color: Brand.blueGlow }, style]}>
      {children.toUpperCase()}
    </Text>
  );
}

/** Serif display heading — the site's .display/.h1 (Cormorant Garamond). */
export function DisplayText({
  children,
  size = 32,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  style?: TextStyle;
}) {
  const c = useBrandColors();
  return (
    <Text
      style={[
        {
          fontFamily: Fonts.display,
          fontSize: size,
          lineHeight: size * 1.05,
          letterSpacing: -0.5,
          color: c.text,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Electric-blue italic serif — the site's `.display em`. */
export function DisplayEm({ children, size = 32 }: { children: string; size?: number }) {
  const c = useBrandColors();
  return (
    <Text
      style={{
        fontFamily: Fonts.displayItalic,
        fontStyle: 'italic',
        fontSize: size,
        lineHeight: size * 1.05,
        color: c.blueElectric,
      }}
    >
      {children}
    </Text>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  /** Optional leading icon inside the input (Ionicons name). */
  leftIcon?: keyof typeof Ionicons.glyphMap;
  /** Optional trailing element (e.g. a password-visibility toggle). */
  rightSlot?: ReactNode;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, leftIcon, rightSlot, style, onFocus, onBlur, ...props },
  ref
) {
  const c = useBrandColors();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? c.danger : focused ? Brand.authAccent : c.border;

  return (
    <View style={styles.fieldWrap}>
      {!!label && <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>}
      <View
        style={[
          styles.inputRow,
          { backgroundColor: c.backgroundElement, borderColor },
        ]}
      >
        {/* Focus ring (design-language §6.4): a 2px translucent halo just
            outside the border — decoration only, never part of layout. */}
        {focused && !error && <View pointerEvents="none" style={styles.focusRing} />}
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={focused ? Brand.authAccent : c.textSecondary}
          />
        )}
        <TextInput
          ref={ref}
          placeholderTextColor={c.textFaint}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.inputInner, { color: c.text }, style]}
          {...props}
        />
        {rightSlot}
      </View>
      {!!error && (
        <Text accessibilityLiveRegion="polite" style={[styles.error, { color: c.danger }]}>
          {error}
        </Text>
      )}
    </View>
  );
});

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** primary = white pill w/ navy text (site .btn-primary); ghost = hairline (site .btn-ghost) */
  variant?: 'primary' | 'ghost';
}) {
  const c = useBrandColors();
  const ghost = variant === 'ghost';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        ghost
          ? { backgroundColor: 'transparent', borderColor: c.borderStrong, borderWidth: 1 }
          : { backgroundColor: c.cta },
        { opacity: pressed || disabled || loading ? 0.7 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={ghost ? c.text : c.ctaText} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: ghost ? c.text : c.ctaText },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function FormError({ message }: { message: string | null }) {
  const c = useBrandColors();
  if (!message) return null;
  return (
    <View
      style={[
        styles.formError,
        { backgroundColor: 'rgba(230,57,70,0.10)', borderColor: 'rgba(230,57,70,0.45)' },
      ]}
    >
      <Text style={{ color: c.danger, fontSize: 14, lineHeight: 20, fontFamily: Fonts.sans }}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 2.4,
  },
  fieldWrap: { gap: Spacing.one + 2, alignSelf: 'stretch' },
  // Geist-style mono field label (design-language §6.4).
  label: {
    fontSize: 11,
    fontFamily: Fonts.mono,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  error: { fontSize: 13, fontFamily: Fonts.sans },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  focusRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: Brand.authFocusRing,
  },
  inputInner: {
    flex: 1,
    paddingVertical: 13,
    fontSize: 16,
    fontFamily: Fonts.sans,
  },
  button: {
    borderRadius: 6,
    paddingVertical: 14,
    paddingHorizontal: 26,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  buttonText: { fontSize: 15, fontFamily: Fonts.sansMedium },
  formError: {
    borderWidth: 1,
    borderRadius: 6,
    padding: Spacing.two + Spacing.one,
    alignSelf: 'stretch',
  },
});
