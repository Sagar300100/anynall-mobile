// Claim your @handle — the post-social-signup completion step.
//
// Email sign-up claims a username atomically inside register(); Google/Apple
// sign-in has no form, so accounts created that way ended up with NO handle at
// all: unfindable by @search, unreachable by /user/[username] deep links, and
// edit-profile (which calls handles permanent) offered no way to add one.
// This screen closes that gap. It is pushed right after a social sign-in
// resolves without a username, and once per session for existing accounts in
// the same state (see session.tsx).
//
// The server is the authority: the availability hook is advisory and the
// atomic claim (Firestore transaction on usernames/{handle}) decides.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GradientCTA, HeadingText } from '@/components/auth-ui';
import { FormError, useBrandColors } from '@/components/ui/form';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  suggestAlternatives,
  suggestUsername,
  usernameProblem,
  useUsernameAvailability,
  USERNAME_HELPER,
} from '@/hooks/use-username-availability';
import { claimUsername } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ensureUserProfile } from '@/lib/users';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function ClaimUsernameScreen() {
  const c = useBrandColors();
  const { user } = useSession();

  const [username, setUsername] = useState(() => suggestUsername(user?.displayName));
  const availability = useUsernameAvailability(username);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only a signed-in user can claim; anyone else has nothing to do here.
  useEffect(() => {
    if (!user) leave();
  }, [user]);

  // Offer verified-free alternatives when the wanted handle is taken.
  useEffect(() => {
    if (availability !== 'taken') {
      setAlternatives([]);
      return;
    }
    let cancelled = false;
    suggestAlternatives(username).then((alts) => {
      if (!cancelled) setAlternatives(alts);
    });
    return () => {
      cancelled = true;
    };
  }, [availability, username]);

  const problem = usernameProblem(username);
  // 'unknown' (availability API unreachable) still allows the attempt — the
  // atomic server-side claim is the real check, exactly as register() treats it.
  const canClaim =
    !busy && !problem && username.trim().length >= 3 && availability !== 'taken' && availability !== 'reserved' && availability !== 'checking';

  async function claim() {
    if (!canClaim) return;
    setBusy(true);
    setError(null);
    try {
      await claimUsername(username);
      // Mirror the fresh handle onto publicProfiles NOW — otherwise search and
      // profile views keep showing the empty username until the next sign-in.
      await ensureUserProfile().catch(() => {});
      leave();
    } catch (e: any) {
      setError(String(e?.message || 'Could not claim the username. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const hint = (() => {
    if (problem) return { text: problem, tone: c.danger };
    switch (availability) {
      case 'checking':
        return { text: 'Checking availability…', tone: c.textSecondary };
      case 'available':
        return { text: `@${username.trim()} is available`, tone: c.primary };
      case 'taken':
        return { text: 'That handle is taken.', tone: c.danger };
      case 'reserved':
        return { text: 'That handle is reserved.', tone: c.danger };
      case 'unknown':
        return { text: 'Couldn’t check availability — you can still try to claim it.', tone: c.textSecondary };
      default:
        return { text: USERNAME_HELPER, tone: c.textSecondary };
    }
  })();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <HeadingText size={30}>Pick your @handle</HeadingText>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Your handle is how people find and mention you on Any&All. It’s permanent, so pick
            one you’ll keep.
          </Text>

          <View style={[styles.field, { borderColor: c.border, backgroundColor: c.backgroundElement }]}>
            <Text style={[styles.at, { color: c.textSecondary }]}>@</Text>
            <TextInput
              value={username}
              onChangeText={(t) => setUsername(t.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="yourhandle"
              placeholderTextColor={c.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              maxLength={20}
              style={[styles.input, { color: c.text }]}
              accessibilityLabel="Username"
              onSubmitEditing={claim}
              returnKeyType="done"
            />
            {availability === 'available' && (
              <Ionicons name="checkmark-circle" size={20} color={c.primary} />
            )}
          </View>
          <Text style={[styles.hint, { color: hint.tone }]}>{hint.text}</Text>

          {alternatives.length > 0 && (
            <View style={styles.altRow}>
              {alternatives.map((alt) => (
                <Pressable
                  key={alt}
                  onPress={() => setUsername(alt)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${alt}`}
                  style={({ pressed }) => [
                    styles.altChip,
                    { borderColor: c.border, backgroundColor: c.backgroundElement },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.altText, { color: c.text }]}>@{alt}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <FormError message={error} />

          <GradientCTA
            title={busy ? 'Claiming…' : 'Claim handle'}
            onPress={claim}
            disabled={!canClaim}
            loading={busy}
          />

          <Pressable onPress={leave} hitSlop={8} style={styles.skip} accessibilityRole="button">
            <Text style={[styles.skipText, { color: c.textSecondary }]}>
              I’ll do this later
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.six,
    gap: Spacing.two,
  },
  sub: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 20, marginBottom: Spacing.two },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    minHeight: 54,
  },
  at: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  input: { flex: 1, fontSize: 17, fontFamily: Fonts.sans, padding: 0 },
  hint: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 17 },
  altRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  altChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  altText: { fontSize: 14, fontFamily: Fonts.sansSemiBold },
  skip: { alignSelf: 'center', paddingVertical: Spacing.two },
  skipText: { fontSize: 13.5, fontFamily: Fonts.sans },
});
