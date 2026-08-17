// Shared vocabulary for the Live Listings surfaces that sit over the show
// room. The studio is a dark full-screen canvas, so these deliberately carry
// their own palette rather than reading the light/dark app theme — a form
// that flipped to a light card over the video would read as a different app.
//
// Accent is Any&All cobalt throughout. The reference these were built from
// uses yellow for its primary buttons; ours never does.
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Fonts, Spacing } from '@/constants/theme';

export const TONE = {
  bg: '#0A1428',
  surface: 'rgba(20,36,70,0.55)',
  border: 'rgba(74,143,229,0.28)',
  borderStrong: 'rgba(74,143,229,0.5)',
  text: '#FFFFFF',
  dim: 'rgba(159,180,216,0.9)',
  faint: 'rgba(159,180,216,0.55)',
  primary: '#2E6BFF',
  required: '#FF8B8B',
  info: 'rgba(20,36,70,0.75)',
} as const;

/** Label with the reference's red required marker. */
export function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.label}>
      {text}
      {required ? <Text style={{ color: TONE.required }}> *</Text> : null}
    </Text>
  );
}

/** Outlined box holding a label above its own value — the shape every field
 *  in the reference uses. */
export function FieldBox({
  label,
  required,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  maxLength,
  prefix,
  minHeight,
  accessibilityLabel,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  multiline?: boolean;
  maxLength?: number;
  /** Rendered inside the box, before the input (e.g. the rupee sign). */
  prefix?: string;
  minHeight?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[styles.box, multiline && { minHeight: minHeight ?? 128 }]}>
      <Label text={label} required={required} />
      <View style={styles.inputRow}>
        {!!prefix && <Text style={styles.prefix}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={TONE.faint}
          keyboardType={keyboardType ?? 'default'}
          multiline={multiline}
          maxLength={maxLength}
          accessibilityLabel={accessibilityLabel ?? label}
          style={[styles.input, multiline && styles.inputMultiline]}
        />
      </View>
    </View>
  );
}

/** Outlined box that opens something else. Shows the chosen value, or the
 *  placeholder when nothing is chosen yet. */
export function SelectBox({
  label,
  required,
  value,
  placeholder,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  required?: boolean;
  value: string;
  placeholder?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.box, styles.boxRow, disabled && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Label text={label} required={required} />
        <Text style={[styles.value, !value && { color: TONE.faint }]} numberOfLines={1}>
          {value || placeholder || ''}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={20} color={TONE.dim} />
    </Pressable>
  );
}

/** Title + body + switch, in a bordered card. */
export function ToggleCard({
  title,
  body,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  body: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.box, styles.boxRow, disabled && { opacity: 0.55 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardBody}>{body}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        trackColor={{ false: 'rgba(120,150,210,0.35)', true: TONE.primary }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

/** Grey strip with an (i) — the reference's helper line under a field. */
export function InfoStrip({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.infoStrip}>
      <Ionicons name="information-circle-outline" size={16} color={TONE.dim} />
      <Text style={styles.infoText}>{children}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/** Pill row where exactly one option is selected. */
export function SegTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segRow} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={({ pressed }) => [
              styles.seg,
              on ? styles.segOn : styles.segOff,
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** − n + control. */
export function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 10000,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <View style={[styles.box, styles.boxRow]}>
      <Text style={[styles.value, { flex: 1 }]}>{label}</Text>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        hitSlop={10}
        style={({ pressed }) => [styles.stepBtn, value <= min && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="remove" size={20} color={TONE.text} />
      </Pressable>
      <View style={styles.stepValue}>
        <Text style={styles.value}>{value}</Text>
      </View>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        hitSlop={10}
        style={({ pressed }) => [styles.stepBtn, value >= max && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="add" size={20} color={TONE.text} />
      </Pressable>
    </View>
  );
}

/** Sticky Cancel + primary pair at the foot of a form. */
export function FooterBar({
  primaryLabel,
  onPrimary,
  onCancel,
  disabled,
  busy,
  bottomInset,
}: {
  primaryLabel: string;
  onPrimary: () => void;
  onCancel: () => void;
  disabled?: boolean;
  busy?: boolean;
  bottomInset: number;
}) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + Spacing.two }]}>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        style={({ pressed }) => [styles.footerBtn, styles.cancelBtn, pressed && { opacity: 0.75 }]}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
      <Pressable
        onPress={onPrimary}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        accessibilityState={{ disabled: !!disabled || !!busy }}
        style={({ pressed }) => [
          styles.footerBtn,
          styles.primaryBtn,
          (disabled || busy) && { opacity: 0.45 },
          pressed && { opacity: 0.85 },
        ]}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{primaryLabel}</Text>}
      </Pressable>
    </View>
  );
}

/** Sheet header: centred title with a close control on the right. */
export function SheetHeader({
  title,
  onClose,
  onBack,
}: {
  title: string;
  onClose?: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={26} color={TONE.text} />
        </Pressable>
      ) : (
        <View style={styles.headerBtn} />
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {onClose ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={26} color={TONE.text} />
        </Pressable>
      ) : (
        <View style={styles.headerBtn} />
      )}
    </View>
  );
}

/** Short, visible marker on a control that has no backing feature yet, so a
 *  seller learns it is unavailable before tapping it rather than after. */
export function NotYetTag() {
  return (
    <View style={styles.notYet}>
      <Text style={styles.notYetText}>Not available yet</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: TONE.dim, fontSize: 13, fontFamily: Fonts.sans },
  box: {
    borderWidth: 1,
    borderColor: TONE.border,
    backgroundColor: TONE.surface,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    paddingVertical: 12,
    gap: 4,
    minHeight: 64,
    justifyContent: 'center',
  },
  boxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  prefix: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  input: { flex: 1, color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sans, padding: 0 },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  value: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sans },

  cardTitle: { color: TONE.text, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },
  cardBody: { color: TONE.dim, fontSize: 13, fontFamily: Fonts.sans, lineHeight: 18 },

  infoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: TONE.info,
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 10,
    marginTop: -Spacing.one,
  },
  infoText: { flex: 1, color: TONE.dim, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },

  sectionTitle: { color: TONE.text, fontSize: 20, fontFamily: Fonts.sansSemiBold, marginTop: Spacing.two },

  segRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  seg: { borderRadius: 10, paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' },
  segOn: { backgroundColor: '#E9EEF6' },
  segOff: { backgroundColor: 'rgba(20,36,70,0.9)', borderWidth: 1, borderColor: TONE.border },
  segText: { color: TONE.text, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  segTextOn: { color: '#0B1B3A' },

  stepBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepValue: {
    minWidth: 74,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: TONE.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TONE.border,
    backgroundColor: TONE.bg,
  },
  footerBtn: { flex: 1, minHeight: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { backgroundColor: 'rgba(120,150,210,0.22)' },
  cancelText: { color: TONE.text, fontSize: 16, fontFamily: Fonts.sansSemiBold },
  primaryBtn: { backgroundColor: TONE.primary },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontFamily: Fonts.sansSemiBold },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    minHeight: 52,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: TONE.text, fontSize: 20, fontFamily: Fonts.sansSemiBold, textAlign: 'center' },

  notYet: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(120,150,210,0.18)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  notYetText: { color: TONE.faint, fontSize: 11, fontFamily: Fonts.sansMedium },
});
