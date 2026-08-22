// Edit profile — the audit's "bio editing MISSING" gap. Display name + bio,
// saved the same way the website saves them:
//
//   PUT /api/profile { handle, bio }   — server-side write to users/{uid}
//                                        (client-write-locked)
//   updateProfile(auth, displayName)   — so headers/chat show the new name
//   ensureUserProfile()                — mirrors both onto publicProfiles so
//                                        the public profile updates everywhere
//
// The @username handle is shown but NOT editable — renaming needs the atomic
// /claim-username reservation and is deliberately out of this screen's scope
// (matches the server's own rule: PUT /api/profile ignores username).
//
// NOTE: the display name feeds Aadhaar name-matching and the locked order
// recipient name, so the screen says so — changing it is not merely cosmetic.
import Ionicons from '@expo/vector-icons/Ionicons';
import { updateProfile as updateAuthProfile } from 'firebase/auth';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageAtmosphere } from '@/components/brand/page-atmosphere';
import { PressScale } from '@/components/brand/press-scale';
import { GuestPrompt } from '@/components/guest-prompt';
import { GradientCTA } from '@/components/brand/gradient-cta';
import { Field, FormError, useBrandColors } from '@/components/ui/form';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { getMyProfile, updateMyProfile } from '@/lib/api';
import { useAuthStatus } from '@/lib/auth-gate';
import { auth } from '@/lib/firebase';
import { ensureUserProfile } from '@/lib/users';

const BIO_MAX = 280; // server truncation limit — mirrored so nothing is lost
const NAME_MAX = 60;

export default function EditProfileScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status !== 'member') return;
    let cancelled = false;
    (async () => {
      try {
        const p = await getMyProfile();
        if (cancelled) return;
        setUsername(p.username || '');
        // Auth displayName is the live truth for the name; the profile doc's
        // handle can lag behind it.
        setName((auth.currentUser?.displayName || p.handle || '').trim());
        setBio(p.bio === 'Tell buyers what you sell and why they should follow.' ? '' : p.bio || '');
      } catch {
        if (!cancelled) setError('Couldn’t load your profile. Check your connection and retry.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  async function save() {
    const cleanName = name.trim();
    setError(null);
    setSaved(false);
    if (!cleanName) {
      setError('Your name can’t be empty.');
      return;
    }
    setSaving(true);
    try {
      // 1. Server-side profile doc (users/{uid}.profile — client-write-locked).
      await updateMyProfile({ handle: cleanName, bio: bio.trim() });
      // 2. Firebase Auth displayName — what chat, orders and KYC compare read.
      const u = auth.currentUser;
      if (u) {
        await updateAuthProfile(u, { displayName: cleanName });
        try {
          await u.reload();
        } catch {
          /* non-fatal */
        }
      }
      // 3. Mirror onto publicProfiles so the public profile updates on both
      //    clients (same hook that runs on every sign-in).
      await ensureUserProfile();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : 'Couldn’t save your profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.root}>
      <PageAtmosphere />
      <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <PressScale
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </PressScale>
        <Text style={[styles.topTitle, { color: c.text }]}>Edit profile</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="create-outline"
          title="Sign in to edit your profile"
          body="Your display name and bio appear on your public profile."
          reason="profile"
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {saved && (
              <View style={[styles.okBox, { borderColor: 'rgba(74,222,128,0.35)' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color="#4ade80" />
                <Text style={[styles.okText, { color: '#4ade80' }]}>
                  Profile saved — it updates everywhere, app and website.
                </Text>
              </View>
            )}

            {!!username && (
              <View style={styles.handleRow}>
                <Ionicons name="at-outline" size={18} color={c.primary} />
                <View style={styles.handleText}>
                  <Text style={[styles.handleLabel, { color: c.text }]}>@{username}</Text>
                  <Text style={[styles.handleNote, { color: c.textFaint }]}>
                    Your handle is permanent — it’s how people find and link to you.
                  </Text>
                </View>
              </View>
            )}

            <Field
              label="Display name"
              value={name}
              onChangeText={(v) => setName(v.slice(0, NAME_MAX))}
              autoComplete="name"
              textContentType="name"
            />
            <Text style={[styles.note, { color: c.textFaint }]}>
              Use your real name: orders ship in this name, and Aadhaar verification must match it.
            </Text>

            <Field
              label="Bio"
              value={bio}
              onChangeText={(v) => setBio(v.slice(0, BIO_MAX))}
              placeholder="Tell buyers what you sell and why they should follow."
              multiline
              numberOfLines={4}
              style={styles.bioInput}
            />
            <Text style={[styles.counter, { color: c.textFaint }]}>
              {bio.length}/{BIO_MAX}
            </Text>

            <FormError message={error} />
            <GradientCTA title={saving ? 'Saving…' : 'Save profile'} onPress={save} disabled={saving || !name.trim()} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.ink950 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  topTitle: { flex: 1, fontSize: 19, fontFamily: Fonts.displayMedium, letterSpacing: -0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, gap: Spacing.three, paddingBottom: 90 },
  note: { fontSize: 12.5, fontFamily: Fonts.ui, lineHeight: 18, marginTop: -Spacing.two },
  counter: { fontSize: 11.5, fontFamily: Fonts.mono, alignSelf: 'flex-end', marginTop: -Spacing.two },
  bioInput: { minHeight: 100, textAlignVertical: 'top' },

  okBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(74,222,128,0.08)',
  },
  okText: { flex: 1, fontSize: 13, fontFamily: Fonts.uiMedium, lineHeight: 18 },

  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderColor: Brand.hairlineWhite,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: Spacing.three,
  },
  handleText: { flex: 1, gap: 2 },
  handleLabel: { fontSize: 14.5, fontFamily: Fonts.uiSemiBold },
  handleNote: { fontSize: 12, fontFamily: Fonts.ui, lineHeight: 17 },
});
