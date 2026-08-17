// Select Category — full-height sheet with search, collapsible parent groups
// and subcategory chips.
//
// Sort tabs: only A–Z is active. "Popular" needs usage data and "Newly Added"
// needs per-category creation dates; neither exists in this backend, so they
// render dimmed rather than silently returning the same alphabetical list
// under a different name.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { filterGroups } from '@/lib/category-tree';

export function CategorySheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** Currently selected subcategory, or ''. */
  value: string;
  onSelect: (subcategory: string) => void;
  onClose: () => void;
}) {
  const c = useBrandColors();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = filterGroups(q);
  // Searching should reveal what it matched, so hits ignore collapsed state.
  const searching = q.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Select Category</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={10}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={24} color={c.text} />
          </Pressable>
        </View>

        <View style={[styles.search, { borderColor: c.border, backgroundColor: c.cardBackground }]}>
          <Ionicons name="search" size={18} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search categories..."
            placeholderTextColor={c.textFaint}
            style={[styles.searchInput, { color: c.text }]}
            accessibilityLabel="Search categories"
            autoCorrect={false}
          />
          {!!q && (
            <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={c.textFaint} />
            </Pressable>
          )}
        </View>

        <View style={styles.tabs}>
          <View style={[styles.tab, styles.tabActive]}>
            <Text style={styles.tabActiveText}>A–Z</Text>
          </View>
          {/* Dimmed and inert: no ranking or recency data exists to sort by. */}
          {['Popular', 'Newly Added'].map((t) => (
            <View
              key={t}
              style={[styles.tab, { backgroundColor: c.cardBackground, opacity: 0.45 }]}
              accessible
              accessibilityLabel={`${t}. Not available yet`}
            >
              <Text style={[styles.tabText, { color: c.textSecondary }]}>{t}</Text>
            </View>
          ))}
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.four }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {groups.length === 0 && (
            <Text style={[styles.empty, { color: c.textSecondary }]}>
              No categories match “{q.trim()}”.
            </Text>
          )}

          {groups.map((g) => {
            const open = searching || !collapsed[g.name];
            return (
              <View key={g.name} style={[styles.group, { borderTopColor: c.border }]}>
                <Pressable
                  onPress={() => setCollapsed((p) => ({ ...p, [g.name]: !p[g.name] }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={g.name}
                  style={({ pressed }) => [styles.groupHead, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.groupName, { color: c.text }]}>{g.name}</Text>
                  <Ionicons
                    name={open ? 'chevron-up' : 'chevron-down'}
                    size={19}
                    color={c.textSecondary}
                  />
                </Pressable>

                {open && (
                  <View style={styles.chips}>
                    {g.subcategories.map((s) => {
                      const selected = s === value;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => {
                            onSelect(s);
                            onClose();
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${s}, in ${g.name}`}
                          style={({ pressed }) => [
                            styles.chip,
                            {
                              backgroundColor: selected ? c.primary : c.cardBackground,
                              borderColor: selected ? c.primary : c.border,
                            },
                            pressed && { opacity: 0.75 },
                          ]}
                        >
                          <Text
                            style={[styles.chipText, { color: selected ? '#FFFFFF' : c.text }]}
                          >
                            {s}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}

          <View style={[styles.request, { borderTopColor: c.border }]}>
            <Text style={[styles.requestTitle, { color: c.text }]}>
              Not seeing a category listed?
            </Text>
            {/* Cobalt, not the reference's yellow. */}
            <Pressable
              onPress={() => onClose()}
              accessibilityRole="button"
              accessibilityLabel="Request a category"
              style={({ pressed }) => [styles.requestBtn, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.requestBtnText}>Request Category</Text>
            </Pressable>
            <Text style={[styles.requestNote, { color: c.textFaint }]}>
              Category requests aren’t wired to a backend yet — contact seller support in the
              meantime.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  title: { flex: 1, fontSize: 20, fontFamily: Fonts.sansSemiBold, textAlign: 'center', marginLeft: 34 },
  closeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sans },

  tabs: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  tab: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 9 },
  tabActive: { backgroundColor: '#E9EEF6' },
  tabActiveText: { color: '#0B1B3A', fontSize: 13.5, fontFamily: Fonts.sansSemiBold },
  tabText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  scroll: { paddingHorizontal: Spacing.three },
  empty: { fontSize: 13.5, fontFamily: Fonts.sans, paddingVertical: Spacing.four },

  group: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  groupName: { flex: 1, fontSize: 16, fontFamily: Fonts.sansSemiBold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: Spacing.two },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  chipText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  request: {
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    marginTop: Spacing.two,
  },
  requestTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  requestBtn: {
    backgroundColor: '#2E6BFF',
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },
  requestNote: {
    fontSize: 11.5,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: Spacing.two,
  },
});
