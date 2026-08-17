// Schedule a Live Show — reached from BOTH Seller Hub entry points
// (Today's Tasks → Schedule a Show, and the blue card's Get Started).
//
// Doubles as EDIT SHOW when an `id` param is present (Show Room → More →
// Edit Show). Same form, same validation; the only difference is that it
// loads the existing show first and updates instead of creating. The
// firestore.rules update rule is owner-only, so an edit is as safe as a
// create.
//
// The show is written straight to Firestore by createShow(); there is no
// server endpoint for this. firestore.rules is what enforces that only an
// approved seller (isSeller === true, ownerUid === auth.uid) can write one.
//
// Rows for things this app can't do yet — moderators, recurrence, video
// preview, promotion — are present because the approved design calls for
// them, but each is visibly disabled and labelled rather than faked.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatePicker } from '@/components/state-picker';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { CategorySheet } from '@/components/category-sheet';
import { SELLING_FORMATS, type SellingFormat } from '@/lib/category-tree';
import { storage } from '@/lib/firebase';
import { createShow, getShowEditable, updateShow, type Discoverability } from '@/lib/shows';
import { useSession } from '@/lib/session';

const TITLE_MAX = 100;
/** Languages Any&All ships copy for today. Not just English. */
const LANGUAGES = ['English', 'हिन्दी (Hindi)', 'मराठी (Marathi)', 'বাংলা (Bengali)', 'தமிழ் (Tamil)', 'తెలుగు (Telugu)'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Builds the date and time choices off-render (React Compiler forbids
 *  reading the clock during render). No native date-picker dependency: the
 *  app already has a bottom-sheet picker, so this reuses it. */
function buildSlots() {
  const now = new Date();
  const dates = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return {
      code: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      name: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    };
  });
  // Default: 30 minutes out, rounded to the next minute — any minute is
  // selectable, so there is no reason to snap the default to a half hour.
  const start = new Date(now);
  start.setMinutes(now.getMinutes() + 30, 0, 0);
  const h24 = start.getHours();
  return {
    dates,
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    hour12: pad(h24 % 12 === 0 ? 12 : h24 % 12),
    minute: pad(start.getMinutes()),
    meridiem: h24 < 12 ? 'AM' : 'PM',
    nowMs: now.getTime(),
  };
}

/** 1–12, 00–59, AM/PM. Every minute of the day is reachable. */
const HOURS = Array.from({ length: 12 }, (_, i) => {
  const v = pad(i + 1);
  return { code: v, name: v };
});
const MINUTES = Array.from({ length: 60 }, (_, i) => {
  const v = pad(i);
  return { code: v, name: v };
});
const MERIDIEMS = [
  { code: 'AM', name: 'AM' },
  { code: 'PM', name: 'PM' },
];

/** 12-hour parts → "HH:MM" on a 24-hour clock. */
function to24h(hour12: string, minute: string, meridiem: string): string {
  const h = Number(hour12) % 12;
  return `${pad(meridiem === 'PM' ? h + 12 : h)}:${minute}`;
}

export default function ScheduleShowScreen() {
  const c = useBrandColors();
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  /** Present → editing that show. Absent → scheduling a new one. */
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = typeof id === 'string' && id ? id : null;
  const [loading, setLoading] = useState(!!editId);

  const [title, setTitle] = useState('');
  const [dateCode, setDateCode] = useState('');
  const [hour12, setHour12] = useState('');
  const [minute, setMinute] = useState('');
  const [meridiem, setMeridiem] = useState('AM');
  const [slots, setSlots] = useState<ReturnType<typeof buildSlots> | null>(null);
  const [category, setCategory] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const [format, setFormat] = useState<SellingFormat>('buy-it-now');
  const [language, setLanguage] = useState('English');
  const [discoverability, setDiscoverability] = useState<Discoverability>('public');
  const [explicit, setExplicit] = useState(false);
  const [muted, setMuted] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Deferred a tick so the state writes aren't synchronous inside the
    // effect body — React Compiler rejects that as a cascading render.
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const s = buildSlots();
      setSlots(s);
      setDateCode(s.date);
      setHour12(s.hour12);
      setMinute(s.minute);
      setMeridiem(s.meridiem);

      if (!editId) return;
      const show = await getShowEditable(editId);
      if (cancelled) return;
      if (!show) {
        setError('That show couldn’t be loaded.');
        setLoading(false);
        return;
      }
      setTitle(show.title);
      setCategory(show.category);
      setFormat(show.sellingFormat);
      setLanguage(show.language);
      setDiscoverability(show.discoverability);
      setExplicit(show.explicitContent);
      setMuted(show.mutedWords.join(', '));
      setThumb(show.thumbnailUrl);

      const when = show.scheduledTimeIso ? new Date(show.scheduledTimeIso) : null;
      if (when && !Number.isNaN(when.getTime())) {
        const code = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
        const h24 = when.getHours();
        setDateCode(code);
        setHour12(pad(h24 % 12 === 0 ? 12 : h24 % 12));
        setMinute(pad(when.getMinutes()));
        setMeridiem(h24 < 12 ? 'AM' : 'PM');
        // A show already in the past isn't in the 60-day forward list, so its
        // own date is prepended — otherwise the picker would show a blank.
        if (!s.dates.some((d) => d.code === code)) {
          setSlots({
            ...s,
            dates: [
              {
                code,
                name: when.toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                }),
              },
              ...s.dates,
            ],
          });
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [editId]);

  // Pure derivation from the two codes — no clock read during render.
  // Local-time construction: "2026-08-11T20:30:00" has no Z/offset, so the
  // device's own zone applies, which is what the seller picked.
  const when =
    dateCode && hour12 && minute
      ? new Date(`${dateCode}T${to24h(hour12, minute, meridiem)}:00`)
      : null;
  const inFuture = !!when && !!slots && when.getTime() > slots.nowMs;

  // An edit starts out already populated, so "unsaved work" can't be inferred
  // from the fields having content the way it can for a new show.
  const dirty = !editId && (!!title.trim() || !!category || !!thumb || !!muted.trim());
  const canSchedule =
    !!title.trim() && inFuture && !!category && !!language && !busy && !uploading && !loading;

  function close() {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard unsaved show?', 'Your show details haven’t been scheduled yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  async function pickThumb() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access to add a thumbnail.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [9, 16],
    });
    if (res.canceled || !res.assets?.[0]?.uri || !user?.uid) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await (await fetch(res.assets[0].uri)).blob();
      if (blob.size > 8 * 1024 * 1024) {
        setError('That image is over 8 MB. Pick a smaller one.');
        return;
      }
      // Same owner-scoped, image-only storage rule the product uploader uses.
      const objectRef = storageRef(storage, `productImages/${user.uid}/show-${Date.now()}.jpg`);
      const task = uploadBytesResumable(objectRef, blob, { contentType: 'image/jpeg' });
      await new Promise<void>((resolve, reject) => {
        task.on('state_changed', undefined, reject, () => resolve());
      });
      setThumb(await getDownloadURL(objectRef));
    } catch {
      setError('Couldn’t upload that image. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function schedule() {
    setError(null);
    setBusy(true);
    const payload = {
      title: title.trim(),
      scheduledAt: when as Date,
      category,
      sellingFormat: format,
      language,
      discoverability,
      explicitContent: explicit,
      mutedWords: [
        // Trim, drop blanks, dedupe, lowercase for matching.
        ...new Set(
          muted
            .split(',')
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean)
        ),
      ],
      thumbnailUrl: thumb,
    };
    try {
      if (editId) {
        await updateShow(editId, payload);
        // Back to the show room the edit was opened from.
        router.back();
        return;
      }
      await createShow(payload);
      // Land back on Seller Hub explicitly. router.back() popped to whatever
      // was beneath this screen in the stack — which was the Live tab — so the
      // seller never saw their new show appear.
      router.replace('/sell');
    } catch {
      // Never clear the form on failure.
      setError(
        editId
          ? 'We couldn’t save your changes. Your edits are still here — please try again.'
          : 'We couldn’t schedule your show. Your details are saved here — please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={[styles.topTitle, { color: c.text }]}>
          {editId ? 'Edit Show' : 'Schedule a Live Show'}
        </Text>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={10}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="close" size={24} color={c.primary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <Field label="Name your show" required>
            <TextInput
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))}
              placeholder="Name your show"
              placeholderTextColor={c.textFaint}
              maxLength={TITLE_MAX}
              accessibilityLabel="Show name"
              style={[styles.input, { color: c.text }]}
            />
          </Field>

          {/* Date + time as two sheets. The app has no native date-picker
              dependency, and adding one isn't worth it for this. */}
          <StatePicker
            label="Date *"
            value={dateCode}
            onChange={setDateCode}
            options={slots?.dates ?? []}
            placeholder="Choose a date"
          />
          {/* Hour / minute / AM-PM, so any minute of the day is reachable. */}
          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <StatePicker
                label="Hour *"
                value={hour12}
                onChange={setHour12}
                options={HOURS}
                placeholder="--"
              />
            </View>
            <View style={{ flex: 1 }}>
              <StatePicker
                label="Minute *"
                value={minute}
                onChange={setMinute}
                options={MINUTES}
                placeholder="--"
              />
            </View>
            <View style={{ flex: 1 }}>
              <StatePicker
                label="AM / PM"
                value={meridiem}
                onChange={setMeridiem}
                options={MERIDIEMS}
                placeholder="--"
              />
            </View>
          </View>
          {!!when && !inFuture && <Err>Pick a date and time in the future.</Err>}

          {/* Present in the approved design, but not buildable yet. */}
          <Disabled icon="people-outline" label="Add Moderators" note="Coming soon" />
          <Disabled icon="repeat-outline" label="Repeats · Does not repeat" note="One-time shows only" />

          {/* Media */}
          <Section title="Media" body="Add a thumbnail to help buyers discover your show." />
          <View style={styles.mediaRow}>
            <Pressable
              onPress={pickThumb}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={thumb ? 'Replace thumbnail' : 'Add a thumbnail'}
              style={[styles.media, { borderColor: 'rgba(74,143,229,0.55)' }]}
            >
              {uploading ? (
                <ActivityIndicator color={c.primary} />
              ) : thumb ? (
                <Image source={{ uri: thumb }} style={styles.mediaImg} contentFit="cover" />
              ) : (
                <>
                  <Ionicons name="image-outline" size={24} color={c.primary} />
                  <Text style={[styles.mediaText, { color: c.text }]}>Add a Thumbnail</Text>
                </>
              )}
            </Pressable>
            <View style={[styles.media, styles.mediaOff, { borderColor: c.border }]}>
              <Ionicons name="play-outline" size={24} color={c.textFaint} />
              <Text style={[styles.mediaText, { color: c.textFaint }]}>Add a Video</Text>
              <Text style={[styles.mediaSub, { color: c.textFaint }]}>Coming soon</Text>
            </View>
          </View>
          {!!thumb && (
            <Pressable onPress={() => setThumb(null)} accessibilityRole="button" hitSlop={6}>
              <Text style={[styles.linkText, { color: c.primary }]}>Remove thumbnail</Text>
            </Pressable>
          )}

          {/* Category — the same list the Categories screen and listings use. */}
          <Section
            title="Primary Category"
            body="Choose the category that best matches your show so buyers can discover it."
          />
          <Pressable
            onPress={() => setCatOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={category ? `Category: ${category}. Change` : 'Choose a category'}
            style={[styles.box, { borderColor: c.border, backgroundColor: c.cardBackground }]}
          >
            <Text style={[styles.boxText, { color: category ? c.text : c.textFaint }]}>
              {category || 'Category *'}
            </Text>
            <Ionicons name="chevron-down" size={17} color={c.textSecondary} />
          </Pressable>

          {/* Only meaningful once a category is picked, mirroring the flow in
              the approved reference. */}
          <Section
            title="Primary Selling Format"
            body="How you'll mainly sell during this show."
          />
          {SELLING_FORMATS.map((f) => (
            <Radio
              key={f.value}
              icon={
                f.value === 'auction'
                  ? 'hammer-outline'
                  : f.value === 'buy-it-now'
                    ? 'pricetag-outline'
                    : 'gift-outline'
              }
              title={f.label}
              body={f.body}
              selected={format === f.value}
              onPress={() => setFormat(f.value)}
            />
          ))}

          {/* Content settings */}
          <Section title="Content Settings" />
          <View style={[styles.rowBox, { borderColor: c.border, backgroundColor: c.cardBackground }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Explicit content</Text>
              <Text style={[styles.rowBody, { color: c.textSecondary }]}>
                Flags your show for an age warning. It does not permit anything Any&All prohibits.
              </Text>
            </View>
            <Switch
              value={explicit}
              onValueChange={setExplicit}
              accessibilityLabel="Explicit content"
              trackColor={{ false: 'rgba(120,150,210,0.3)', true: '#2E6BFF' }}
              thumbColor="#FFFFFF"
            />
          </View>

          <Field label="Muted words">
            <TextInput
              value={muted}
              onChangeText={setMuted}
              placeholder="Separate words with commas"
              placeholderTextColor={c.textFaint}
              accessibilityLabel="Muted words, comma separated"
              style={[styles.input, { color: c.text }]}
            />
          </Field>

          {/* Language */}
          <Section
            title="Primary Language"
            body="Set the primary language of your show to help buyers discover it."
          />
          <StatePicker
            label="Primary Language *"
            value={language}
            onChange={setLanguage}
            options={LANGUAGES.map((v) => ({ code: v, name: v }))}
            placeholder="Choose a language"
          />

          {/* Discoverability */}
          <Section title="Show Discoverability" body="Choose who can discover your show." />
          <Radio
            icon="globe-outline"
            title="Public"
            body="Discoverable by everyone."
            selected={discoverability === 'public'}
            onPress={() => setDiscoverability('public')}
          />
          <Radio
            icon="lock-closed-outline"
            title="Private"
            body="Only discoverable through sharing."
            selected={discoverability === 'private'}
            onPress={() => setDiscoverability('private')}
          />

          <Disabled icon="megaphone-outline" label="Promote Show" note="Coming soon" />

          {!!error && <Err>{error}</Err>}
        </ScrollView>

        {/* Bottom actions */}
        <View
          style={[
            styles.actions,
            {
              borderTopColor: c.border,
              backgroundColor: c.background,
              paddingBottom: insets.bottom + Spacing.two,
            },
          ]}
        >
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.cancel,
              { borderColor: c.border, backgroundColor: c.cardBackground },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.cancelText, { color: c.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={schedule}
            disabled={!canSchedule}
            accessibilityRole="button"
            accessibilityLabel="Schedule show"
            accessibilityState={{ disabled: !canSchedule, busy }}
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: '#2E6BFF' },
              !canSchedule && { opacity: 0.45 },
              pressed && canSchedule && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>{editId ? 'Save changes' : 'Schedule'}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <CategorySheet
        visible={catOpen}
        value={category}
        onSelect={setCategory}
        onClose={() => setCatOpen(false)}
      />
    </SafeAreaView>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const c = useBrandColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.textSecondary }]}>
        {label}
        {required && <Text style={{ color: '#E5484D' }}> *</Text>}
      </Text>
      <View style={[styles.box, { borderColor: c.border, backgroundColor: c.cardBackground }]}>
        {children}
      </View>
    </View>
  );
}

function Section({ title, body }: { title: string; body?: string }) {
  const c = useBrandColors();
  return (
    <View style={{ gap: 4, marginTop: Spacing.two }}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
      {!!body && <Text style={[styles.rowBody, { color: c.textSecondary }]}>{body}</Text>}
    </View>
  );
}

/** Present because the approved design includes it, visibly inert because the
 *  capability doesn't exist — never a control that silently does nothing. */
function Disabled({
  icon,
  label,
  note,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  note: string;
}) {
  const c = useBrandColors();
  return (
    <View
      style={[styles.rowBox, { borderColor: c.border, backgroundColor: c.cardBackground, opacity: 0.55 }]}
      accessible
      accessibilityLabel={`${label}. ${note}`}
    >
      <Ionicons name={icon} size={19} color={c.textFaint} />
      <Text style={[styles.rowTitle, { flex: 1, color: c.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowBody, { color: c.textFaint }]}>{note}</Text>
    </View>
  );
}

function Radio({
  icon,
  title,
  body,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => [
        styles.rowBox,
        {
          borderColor: selected ? c.primary : c.border,
          backgroundColor: selected ? 'rgba(46,107,255,0.12)' : c.cardBackground,
        },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Ionicons name={icon} size={19} color={selected ? c.primary : c.textSecondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: c.text }]}>{title}</Text>
        <Text style={[styles.rowBody, { color: c.textSecondary }]}>{body}</Text>
      </View>
      <View style={[styles.radio, { borderColor: selected ? c.primary : c.borderStrong }]}>
        {selected && <View style={[styles.radioDot, { backgroundColor: c.primary }]} />}
      </View>
    </Pressable>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.err} accessibilityLiveRegion="assertive">
      <Ionicons name="alert-circle-outline" size={16} color="#E5484D" />
      <Text style={styles.errText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    minHeight: 48,
  },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.sansSemiBold, textAlign: 'center', marginLeft: 34 },
  closeBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.two },
  label: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
  timeRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    minHeight: 52,
  },
  boxText: { flex: 1, fontSize: 14, fontFamily: Fonts.sans },
  input: { flex: 1, fontSize: 14, fontFamily: Fonts.sans, paddingVertical: Spacing.two },

  sectionTitle: { fontSize: 16, fontFamily: Fonts.sansSemiBold },
  rowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.two,
    minHeight: 56,
  },
  rowTitle: { fontSize: 14, fontFamily: Fonts.sansMedium },
  rowBody: { fontSize: 12, fontFamily: Fonts.sans, lineHeight: 16.5 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },

  mediaRow: { flexDirection: 'row', gap: Spacing.two },
  media: {
    flex: 1,
    height: 132,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  mediaOff: { opacity: 0.55 },
  mediaImg: { width: '100%', height: '100%' },
  mediaText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  mediaSub: { fontSize: 11, fontFamily: Fonts.sans },
  linkText: { fontSize: 13, fontFamily: Fonts.sansMedium },

  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancel: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  submit: {
    flex: 1.4,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#FFFFFF', fontSize: 15, fontFamily: Fonts.sansSemiBold },

  err: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  errText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17, color: '#E5484D' },
});
