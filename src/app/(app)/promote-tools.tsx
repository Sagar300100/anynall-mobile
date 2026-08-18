// Promote tools — mobile port of the REAL half of the website's
// PromoteToolsPanel: the Social Templates Studio's AI caption generator,
// against the deployed 'marketing' agent (POST /api/agent/marketing/chat).
// Replaces the Seller Tools "Promote Tools" stub.
//
// Same covenant as the web studio: NO FAKE DATA — captions are generated
// only from the seller's real upcoming shows, with an honest empty state
// when there are none. The prompt and the [INSTAGRAM]/[TWITTER]/[WHATSAPP]
// parse format are identical to the web's, so both clients get the same
// quality of output from the same agent.
//
// NOT ported, honestly: the web studio's canvas-rendered PNG graphics
// (Story/Post images) — canvas is web-only tech, and the website's
// "Shareable Links" card is a dead button with no link backend behind it.
// On mobile, each caption instead gets the native SHARE SHEET — which is
// what a seller actually does with a caption on a phone.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { streamAgent, type AgentStream } from '@/lib/agent';
import type { ShowData } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';
import { fetchMyUpcomingShows } from '@/lib/shows';

interface Captions {
  instagram: string;
  twitter: string;
  whatsapp: string;
}

/** Same format contract as the web studio — identical prompt, identical parse. */
function parseCaptions(raw: string): Captions | null {
  const m = raw.match(/\[INSTAGRAM\]([\s\S]*?)\[TWITTER\]([\s\S]*?)\[WHATSAPP\]([\s\S]*)/i);
  if (!m) return null;
  return { instagram: m[1].trim(), twitter: m[2].trim(), whatsapp: m[3].trim() };
}

function showWhen(show: ShowData): string {
  if (show.scheduled_time) {
    const d = new Date(show.scheduled_time);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }
  return [show.date, show.time].filter(Boolean).join(' · ') || 'Coming soon';
}

const CHANNELS: { key: keyof Captions; label: string; icon: string }[] = [
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
  { key: 'twitter', label: 'X / Twitter', icon: 'logo-twitter' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
];

export default function PromoteToolsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [shows, setShows] = useState<ShowData[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [genState, setGenState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [raw, setRaw] = useState('');
  const [captions, setCaptions] = useState<Captions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<AgentStream | null>(null);

  // Abandoning the screen mid-generation must kill the request.
  useEffect(() => () => streamRef.current?.cancel(), []);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      (async () => {
        try {
          const list = await fetchMyUpcomingShows();
          if (cancelled) return;
          setShows(list);
          setSelectedId((prev) => prev ?? (list[0] ? String(list[0].id) : null));
        } catch {
          if (!cancelled) setError('Couldn’t load your shows. Check your connection and retry.');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [status])
  );

  const show = (shows || []).find((s) => String(s.id) === selectedId) || null;

  async function generate() {
    if (!show || genState === 'loading') return;
    setGenState('loading');
    setCaptions(null);
    setRaw('');
    setError(null);

    // Identical prompt to the website's studio — same agent, same output
    // contract, no invented facts (the agent uses placeholders when unsure).
    const prompt = [
      `Write social media captions announcing this live shopping show on Any & All (anynall.com), an Indian live-auction marketplace.`,
      `Show title: ${show.name}`,
      `When: ${showWhen(show)} IST`,
      show.category ? `Category: ${show.category}` : '',
      show.seller && show.seller !== 'Anonymous' ? `Seller handle: @${show.seller}` : '',
      ``,
      `Reply in EXACTLY this format with no extra commentary before or after:`,
      `[INSTAGRAM]`,
      `(2-3 energetic lines, emojis welcome, end with 4-6 relevant hashtags)`,
      `[TWITTER]`,
      `(one post under 240 characters including 2-3 hashtags)`,
      `[WHATSAPP]`,
      `(2 short friendly lines for customer groups, include the date/time and anynall.com)`,
    ]
      .filter(Boolean)
      .join('\n');

    const stream = streamAgent('marketing', [{ role: 'user', content: prompt }], (delta) =>
      setRaw((prev) => prev + delta)
    );
    streamRef.current = stream;

    try {
      const full = await stream.promise;
      const parsed = parseCaptions(full);
      if (parsed) setCaptions(parsed);
      else if (full.trim()) setCaptions({ instagram: full.trim(), twitter: '', whatsapp: '' });
      else {
        setGenState('error');
        return;
      }
      setGenState('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Caption generation failed. Try again.');
      setGenState('error');
    } finally {
      streamRef.current = null;
    }
  }

  async function shareCaption(text: string) {
    try {
      await Share.share({ message: text });
    } catch {
      /* user dismissed the sheet */
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/seller-tools'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Promote tools</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="megaphone-outline"
          title="Sign in to promote your shows"
          body="AI-written captions for your upcoming shows live here."
          reason="sell"
        />
      ) : shows === null && !error ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : shows !== null && shows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="megaphone-outline" size={34} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No upcoming shows to promote</Text>
          <Text style={[styles.emptyBody, { color: c.textSecondary }]}>
            Schedule a show first — captions are generated from real show details, never invented
            ones.
          </Text>
          <Pressable
            onPress={() => router.push('/show-new')}
            accessibilityRole="button"
            accessibilityLabel="Schedule a show"
            style={({ pressed }) => [
              styles.emptyBtn,
              { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.emptyBtnText, { color: c.ctaText }]}>Schedule a show</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.body, { color: c.textSecondary }]}>
            Pick a show and generate ready-to-post captions for Instagram, X and WhatsApp — written
            by the Any&All marketing assistant from your real show details.
          </Text>

          {/* ── Show picker ── */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>YOUR NEXT SHOWS</Text>
          <View style={styles.showList}>
            {(shows || []).slice(0, 6).map((s) => {
              const active = String(s.id) === selectedId;
              return (
                <Pressable
                  key={String(s.id)}
                  onPress={() => {
                    setSelectedId(String(s.id));
                    setCaptions(null);
                    setRaw('');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Promote ${s.name}`}
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.showRow,
                    {
                      backgroundColor: c.cardBackground,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                >
                  <View style={styles.showText}>
                    <Text style={[styles.showName, { color: c.text }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={[styles.showMeta, { color: c.textSecondary }]} numberOfLines={1}>
                      {s.isLive ? 'LIVE now' : showWhen(s)}
                      {s.category ? ` · ${s.category}` : ''}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={generate}
            disabled={!show || genState === 'loading'}
            accessibilityRole="button"
            accessibilityLabel="Generate captions"
            style={({ pressed }) => [
              styles.generateBtn,
              {
                backgroundColor: c.cta,
                opacity: pressed || !show || genState === 'loading' ? 0.7 : 1,
              },
            ]}
          >
            {genState === 'loading' ? (
              <ActivityIndicator size="small" color={c.ctaText} />
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color={c.ctaText} />
                <Text style={[styles.generateText, { color: c.ctaText }]}>
                  {captions ? 'Regenerate captions' : 'Generate captions'}
                </Text>
              </>
            )}
          </Pressable>

          {!!error && <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>}

          {/* Streaming preview while the reply is arriving. */}
          {genState === 'loading' && !!raw && (
            <View style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
              <Text style={[styles.streamText, { color: c.textSecondary }]}>{raw}</Text>
            </View>
          )}

          {/* ── Captions ── */}
          {captions &&
            CHANNELS.map(({ key, label, icon }) => {
              const text = captions[key];
              if (!text) return null;
              return (
                <View
                  key={key}
                  style={[styles.card, { backgroundColor: c.cardBackground, borderColor: c.border }]}
                >
                  <View style={styles.cardHead}>
                    <Ionicons name={icon as never} size={16} color={c.primary} />
                    <Text style={[styles.cardTitle, { color: c.text }]}>{label}</Text>
                    <Pressable
                      onPress={() => shareCaption(text)}
                      accessibilityRole="button"
                      accessibilityLabel={`Share the ${label} caption`}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.shareBtn,
                        { borderColor: c.borderStrong, opacity: pressed ? 0.7 : 1 },
                      ]}
                    >
                      <Ionicons name="share-social-outline" size={13} color={c.primary} />
                      <Text style={[styles.shareText, { color: c.primary }]}>Share</Text>
                    </Pressable>
                  </View>
                  <Text selectable style={[styles.captionText, { color: c.textSecondary }]}>
                    {text}
                  </Text>
                </View>
              );
            })}

          {captions && (
            <Text style={[styles.hint, { color: c.textFaint }]}>
              Long-press any caption to copy it. Branded Story/Post graphics for these shows are in
              the website’s Template Studio (Seller Hub → Promote Tools).
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two + Spacing.one, paddingBottom: 90 },
  body: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20 },
  hint: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 18 },
  sectionLabel: { fontSize: 11.5, fontFamily: Fonts.sansMedium, letterSpacing: 1.1, marginLeft: 4, marginBottom: -Spacing.one },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  emptyTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
  emptyBody: { fontSize: 13.5, fontFamily: Fonts.sans, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
  emptyBtn: { borderRadius: 999, paddingHorizontal: Spacing.four, minHeight: 44, justifyContent: 'center', marginTop: Spacing.two },
  emptyBtnText: { fontSize: 13.5, fontFamily: Fonts.sansMedium },

  showList: { gap: Spacing.two },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    minHeight: 56,
  },
  showText: { flex: 1, gap: 1 },
  showName: { fontSize: 14, fontFamily: Fonts.sansMedium },
  showMeta: { fontSize: 12, fontFamily: Fonts.sans },

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: 999,
    minHeight: 48,
  },
  generateText: { fontSize: 14, fontFamily: Fonts.sansMedium },

  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three + Spacing.one, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardTitle: { flex: 1, fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 34,
  },
  shareText: { fontSize: 12, fontFamily: Fonts.sansMedium },
  captionText: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  streamText: { fontSize: 13, fontFamily: Fonts.mono, lineHeight: 19 },
});
