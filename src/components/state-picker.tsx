// GST State/UT picker — shared by the GSTIN and enrolment steps.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { IN_STATES } from '@/lib/seller';

export function StatePicker({
  value,
  onChange,
  label,
  hint,
  options,
  placeholder,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  hint?: string;
  /** Defaults to the GST State/UT list. Any {code,name} list works, so the
   *  same sheet backs categories and languages instead of three near-copies. */
  options?: readonly { code: string; name: string }[];
  /** Empty-state text. Defaults to the State/UT wording. */
  placeholder?: string;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const items = options ?? IN_STATES;
  const selected = items.find((s) => s.code === value);

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={selected ? `Selected: ${selected.name}` : placeholder ?? 'Select a State or UT'}
        style={({ pressed }) => [
          styles.field,
          { backgroundColor: c.backgroundElement, borderColor: c.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={{ color: selected ? c.text : c.textFaint, fontSize: 14.5, fontFamily: Fonts.sans }}>
          {selected
            ? // GST codes are meaningful to the seller, so states show
              // "27 — Maharashtra". Custom lists (categories, dates) have
              // opaque codes, so they show the name alone.
              options
              ? selected.name
              : `${selected.code} — ${selected.name}`
            : (placeholder ?? 'Select State/UT')}
        </Text>
        <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
      </Pressable>
      {!!hint && <Text style={[styles.hint, { color: c.textFaint }]}>{hint}</Text>}

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} accessibilityLabel="Close" onPress={() => setOpen(false)} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.cardBackground, borderColor: c.border, paddingBottom: insets.bottom + Spacing.two },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <Text style={[styles.sheetTitle, { color: c.text }]}>{label}</Text>
          <ScrollView style={{ maxHeight: 400 }}>
            {items.map((s) => (
              <Pressable
                key={s.code}
                onPress={() => {
                  onChange(s.code);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: s.code === value }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(120,150,210,0.08)' }]}
              >
                <Text
                  style={{
                    color: s.code === value ? c.primary : c.text,
                    fontSize: 14.5,
                    fontFamily: Fonts.sans,
                  }}
                >
                  {/* Same rule as the trigger: GST codes are meaningful, so
                      states read "27 — Maharashtra". Custom lists use the code
                      as the value itself, so showing both duplicates it. */}
                  {options ? s.name : `${s.code} — ${s.name}`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 48,
  },
  hint: { fontSize: 11.5, fontFamily: Fonts.sans },
  backdrop: { flex: 1, backgroundColor: 'rgba(2,5,14,0.6)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  row: { paddingVertical: 12, paddingHorizontal: 6, borderRadius: 8 },
});
