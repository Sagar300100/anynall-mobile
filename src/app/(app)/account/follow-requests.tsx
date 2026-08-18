// Follow requests — the approval queue for a private account, using the same
// followRequests collection and accept/decline semantics as the website's
// profile page. Accepting atomically creates the follows row and removes the
// request (one batch — the rules allow the row precisely because the pending
// request exists).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import {
  acceptFollowRequest,
  declineFollowRequest,
  listIncomingRequests,
  type PersonRef,
} from '@/lib/follows';

export default function FollowRequestsScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [requests, setRequests] = useState<PersonRef[] | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (status !== 'member') return;
      let cancelled = false;
      (async () => {
        const list = await listIncomingRequests();
        if (!cancelled) setRequests(list);
      })();
      return () => {
        cancelled = true;
      };
    }, [status])
  );

  async function decide(uid: string, accept: boolean) {
    if (busyUid) return;
    setBusyUid(uid);
    try {
      if (accept) await acceptFollowRequest(uid);
      else await declineFollowRequest(uid);
      setRequests((prev) => (prev ? prev.filter((p) => p.uid !== uid) : prev));
    } catch {
      /* row stays — the user can simply retry */
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="arrow-back" size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: c.text }]}>Follow requests</Text>
      </View>

      {status === 'loading' ? null : status === 'guest' ? (
        <GuestPrompt
          icon="person-add-outline"
          title="Sign in to manage requests"
          body="Follow requests appear here when your account is private."
          reason="profile"
        />
      ) : requests === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="person-add-outline" size={36} color={c.textFaint} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>No pending requests</Text>
          <Text style={[styles.body, styles.emptyBody, { color: c.textSecondary }]}>
            When your account is private, people who want to follow you appear here for approval.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.group, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
            {requests.map((p, i) => (
              <View key={p.uid}>
                {i > 0 && <View style={[styles.divider, { backgroundColor: c.border }]} />}
                <View style={styles.row}>
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: '/user/[username]',
                        params: { username: p.username || p.uid, uid: p.uid },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View ${p.name}'s profile`}
                    style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}
                  >
                    {p.photoURL ? (
                      <Image source={{ uri: p.photoURL }} style={styles.avatar} contentFit="cover" />
                    ) : (
                      <View style={[styles.avatar, styles.avatarEmpty, { borderColor: c.border }]}>
                        <Ionicons name="person-outline" size={16} color={c.textSecondary} />
                      </View>
                    )}
                    <View style={styles.personText}>
                      <Text style={[styles.personName, { color: c.text }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {!!p.username && (
                        <Text style={[styles.personHandle, { color: c.textFaint }]} numberOfLines={1}>
                          @{p.username}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  {busyUid === p.uid ? (
                    <ActivityIndicator size="small" color={c.textSecondary} />
                  ) : (
                    <View style={styles.decisions}>
                      <Pressable
                        onPress={() => decide(p.uid, true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Accept ${p.name}'s request`}
                        style={({ pressed }) => [
                          styles.decideBtn,
                          { backgroundColor: c.cta, opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Text style={[styles.decideText, { color: c.ctaText }]}>Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => decide(p.uid, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Decline ${p.name}'s request`}
                        style={({ pressed }) => [
                          styles.decideBtn,
                          styles.declineBtn,
                          { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                        ]}
                      >
                        <Text style={[styles.decideText, { color: c.textSecondary }]}>Decline</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
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
  body: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 21 },
  emptyTitle: { fontSize: 16.5, fontFamily: Fonts.sansSemiBold },
  emptyBody: { textAlign: 'center', maxWidth: 300 },

  scroll: { padding: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.six },
  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    minHeight: 62,
  },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarEmpty: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  personText: { flex: 1, gap: 1 },
  personName: { fontSize: 14.5, fontFamily: Fonts.sansMedium },
  personHandle: { fontSize: 12, fontFamily: Fonts.sans },

  decisions: { flexDirection: 'row', gap: Spacing.two },
  decideBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    minHeight: 38,
    justifyContent: 'center',
  },
  declineBtn: { backgroundColor: 'transparent', borderWidth: 1 },
  decideText: { fontSize: 12.5, fontFamily: Fonts.sansMedium },
});
