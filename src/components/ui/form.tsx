// Shared UI primitives styled to the website's brand-v2 system: white
// primary buttons with navy text, ghost buttons with blue hairlines, dark
// panel inputs, mono uppercase eyebrows, serif display headings.
import { forwardRef } from 'react';
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

import { Colors, Fonts, Spacing } from '@/constants/theme';

// Site is dark-only navy; hook kept so screens don't care.
export function useBrandColors() {
  return Colors.dark;
}

/** Mono uppercase letter-spaced label — the site's .eyebrow. */
export function Eyebrow({ children, style }: { children: string; style?: TextStyle }) {
  const c = useBrandColors();
  return (
    <Text style={[styles.eyebrow, { color: c.primary }, style]}>
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

type FieldProps = TextInputProps & { label: string; error?: string | null };

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, ...props },
  ref
) {
  const c = useBrandColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={c.textFaint}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.backgroundElement,
            borderColor: error ? c.danger : c.border,
          },
          style,
        ]}
        {...props}
      />
      {!!error && <Text style={[styles.error, { color: c.danger }]}>{error}</Text>}
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
  label: { fontSize: 13, fontFamily: Fonts.sansMedium },
  error: { fontSize: 13, fontFamily: Fonts.sans },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.three,
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
