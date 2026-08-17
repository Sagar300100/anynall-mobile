// Renders the verbatim policy text in src/data/legal-content.ts — the mobile
// counterpart of renderPolicy() in the website's pages/LegalPage.tsx.
//
// The source markup is a deliberately tiny subset (no inline formatting at
// all, verified against the data): "## " h2, "### " h3, "- " bullet,
// "|cell|cell|" table rows, and blank-line-separated paragraphs. That's why
// this is a 40-line parser and not a markdown library — the input is fixed and
// legal text must render exactly, not "mostly".
//
// TABLES ON A PHONE
// The three policy tables are 3-column. Rendering them as a real grid at
// 390dp either truncates cells or needs horizontal scrolling, and a buyer who
// scrolls past a clipped GST rule has effectively not been shown it. Each row
// is instead stacked as label/value pairs keyed by the header cell, so every
// word survives at any width.
import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';

type Block =
  | { kind: 'h2'; text: string; id: string }
  | { kind: 'h3'; text: string; id: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'p'; text: string };

/**
 * Stable, human-readable anchor ids derived from the heading text
 * ("2. When a Buyer May Get a Refund" → "when-a-buyer-may-get-a-refund").
 *
 * This MUST stay character-for-character identical to makeSlugger() on the
 * website: the Help Center's `hash` values are shared between both clients, so
 * a drift here silently breaks every deep link into a policy section.
 */
function makeSlugger() {
  const seen = new Set<string>();
  return (heading: string) => {
    let slug = heading
      .toLowerCase()
      .replace(/^\d+(\.\d+)*\.?\s+/, '') // strip "12." / "12.5" numbering
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (seen.has(slug)) {
      let n = 2;
      while (seen.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    seen.add(slug);
    return slug;
  };
}

function parsePolicy(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  const slugify = makeSlugger();
  let i = 0;

  while (i < lines.length) {
    const l = lines[i].trim();
    if (!l) {
      i++;
      continue;
    }
    if (l.startsWith('### ')) {
      const t = l.slice(4);
      out.push({ kind: 'h3', text: t, id: slugify(t) });
      i++;
      continue;
    }
    if (l.startsWith('## ')) {
      const t = l.slice(3);
      out.push({ kind: 'h2', text: t, id: slugify(t) });
      i++;
      continue;
    }
    if (l.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      out.push({ kind: 'ul', items });
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim())
        );
        i++;
      }
      const [head, ...body] = rows;
      out.push({ kind: 'table', head: head ?? [], rows: body });
      continue;
    }
    out.push({ kind: 'p', text: l });
    i++;
  }
  return out;
}

export function PolicyDocument({
  markdown,
  /** Section slug to jump to on open (the Help Center's `hash` values). */
  sectionId,
  header,
  footer,
}: {
  markdown: string;
  sectionId?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const c = useBrandColors();
  const blocks = useMemo(() => parsePolicy(markdown), [markdown]);

  const scrollRef = useRef<ScrollView>(null);
  // Heading y-offsets, filled in by onLayout as the document mounts.
  const offsets = useRef<Record<string, number>>({});
  // Layout is asynchronous, so a deep link almost always arrives BEFORE the
  // target heading has measured. Remember what we still owe and honour it the
  // moment that heading reports its position — refs and an imperative scroll
  // only, no state: these documents have 160+ headings and re-rendering per
  // measurement would make opening Terms visibly janky.
  const pending = useRef<string | undefined>(sectionId);

  function scrollToHeading(id: string) {
    const y = offsets.current[id];
    if (y === undefined) return false;
    pending.current = undefined;
    // A little headroom so the heading isn't flush against the top bar.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 14), animated: true });
    return true;
  }

  useEffect(() => {
    if (!sectionId) return;
    pending.current = sectionId;
    scrollToHeading(sectionId); // already measured → jump now
  }, [sectionId]);

  function measure(id: string) {
    return (e: LayoutChangeEvent) => {
      offsets.current[id] = e.nativeEvent.layout.y;
      if (pending.current === id) scrollToHeading(id); // measured late → jump now
    };
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {header}

      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h2':
            return (
              <Text
                key={i}
                onLayout={measure(b.id)}
                accessibilityRole="header"
                style={[styles.h2, { color: c.text }]}
              >
                {b.text}
              </Text>
            );
          case 'h3':
            return (
              <Text
                key={i}
                onLayout={measure(b.id)}
                accessibilityRole="header"
                style={[styles.h3, { color: c.text }]}
              >
                {b.text}
              </Text>
            );
          case 'ul':
            return (
              <View key={i} style={styles.list}>
                {b.items.map((it, j) => (
                  <View key={j} style={styles.listItem}>
                    <Text style={[styles.bullet, { color: c.primary }]}>•</Text>
                    <Text style={[styles.body, { color: c.textSecondary }]}>{it}</Text>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              <View key={i} style={styles.table}>
                {b.rows.map((row, j) => (
                  <View
                    key={j}
                    style={[
                      styles.tableRow,
                      { backgroundColor: c.cardBackground, borderColor: c.border },
                    ]}
                  >
                    {row.map((cell, k) => (
                      <View key={k} style={styles.tableCell}>
                        {!!b.head[k] && (
                          <Text style={[styles.tableLabel, { color: c.primary }]}>
                            {b.head[k].toUpperCase()}
                          </Text>
                        )}
                        <Text style={[styles.body, { color: c.text }]}>{cell}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          default:
            return (
              <Text key={i} style={[styles.body, styles.para, { color: c.textSecondary }]}>
                {b.text}
              </Text>
            );
        }
      })}

      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.six },
  h2: {
    fontFamily: Fonts.display,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.3,
    marginTop: Spacing.four + Spacing.one,
    marginBottom: Spacing.two,
  },
  h3: {
    fontFamily: Fonts.sansSemiBold,
    fontSize: 15,
    lineHeight: 21,
    marginTop: Spacing.three + Spacing.one,
    marginBottom: Spacing.one,
  },
  body: { flex: 1, fontFamily: Fonts.sans, fontSize: 14.5, lineHeight: 22 },
  para: { marginBottom: Spacing.two + Spacing.half },
  list: { gap: Spacing.two, marginBottom: Spacing.two + Spacing.half },
  listItem: { flexDirection: 'row', gap: Spacing.two + Spacing.half, paddingRight: Spacing.two },
  bullet: { fontSize: 15, lineHeight: 22 },
  table: { gap: Spacing.two, marginVertical: Spacing.two },
  tableRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.half,
  },
  tableCell: { gap: 3 },
  tableLabel: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.4 },
});
