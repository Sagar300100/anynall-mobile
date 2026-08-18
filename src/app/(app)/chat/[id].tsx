// 1:1 message thread — conversations/{id}/messages. Marks the thread read on
// open and on every incoming batch, mirrors the web Messages page behaviour.
//
// MESSAGE REQUESTS: a new conversation is a request until the recipient
// accepts. The requester may write their opening messages; the recipient sees
// an Accept / Decline banner instead of the composer. Declined closes the
// thread for both (the recipient can still change their mind and accept).
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import {
  acceptConversation,
  declineConversation,
  markConversationRead,
  sendThreadMessage,
  subscribeConversation,
  subscribeThreadMessages,
  type ChatMessage,
  type ConversationStatus,
} from '@/lib/conversations';
import { useSession } from '@/lib/session';

export default function ChatThreadScreen() {
  const c = useBrandColors();
  const { id, otherUid, otherName } = useLocalSearchParams<{
    id: string;
    otherUid?: string;
    otherName?: string;
  }>();
  const { user } = useSession();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null while the conversation doc is loading — the composer stays hidden
  // until we know the request state, so a gated thread never flashes open.
  const [conv, setConv] = useState<{ status: ConversationStatus; requesterId: string } | null>(
    null
  );
  const [deciding, setDeciding] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!id) return;
    return subscribeConversation(String(id), setConv);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const off = subscribeThreadMessages(
      String(id),
      (msgs) => {
        setMessages(msgs);
        // Anything that arrived while the thread is open is read.
        markConversationRead(String(id));
      },
      setError
    );
    return off;
  }, [id]);

  const iAmRequester = !!conv && (!conv.requesterId || conv.requesterId === user?.uid);
  const pendingForMe = !!conv && conv.status === 'pending' && !iAmRequester;
  const declined = conv?.status === 'declined';
  // Composer: accepted chats always; pending only for the requester (their
  // messages are the request). Hidden entirely while the doc loads.
  const canWrite =
    !!conv && (conv.status === 'accepted' || (conv.status === 'pending' && iAmRequester));

  async function decide(accept: boolean) {
    if (deciding || !id) return;
    setDeciding(true);
    try {
      if (accept) await acceptConversation(String(id));
      else await declineConversation(String(id));
    } catch {
      setError("Couldn't update the request. Try again.");
    } finally {
      setDeciding(false);
    }
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendThreadMessage(String(id), String(otherUid || ''), text);
    } catch (err: any) {
      setDraft(text);
      setError(err?.message || 'Could not send. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, { borderColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        <View style={[styles.avatar, { backgroundColor: c.backgroundSelected }]}>
          <Text style={[styles.avatarText, { color: c.primary }]}>
            {String(otherName || 'U').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles.name, { color: c.text }]}>
          {otherName || 'Conversation'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const mine = item.senderId === user?.uid;
            return (
              <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View
                  style={[
                    styles.bubble,
                    mine
                      ? { backgroundColor: c.blue, borderTopRightRadius: 4 }
                      : {
                          backgroundColor: c.backgroundElement,
                          borderTopLeftRadius: 4,
                          borderWidth: 1,
                          borderColor: c.border,
                        },
                  ]}
                >
                  <Text style={[styles.bubbleText, { color: c.text }]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />

        {!!error && (
          <View style={[styles.errorBar, { backgroundColor: 'rgba(230,57,70,0.14)', borderColor: 'rgba(230,57,70,0.5)' }]}>
            <Text style={{ color: c.text, fontSize: 12, fontFamily: Fonts.sans }}>{error}</Text>
          </View>
        )}

        {/* ── Message-request states ── */}
        {pendingForMe && (
          <View style={[styles.requestBar, { backgroundColor: c.backgroundElement, borderColor: c.borderStrong }]}>
            <Text style={[styles.requestTitle, { color: c.text }]}>
              {otherName || 'This person'} wants to message you
            </Text>
            <Text style={[styles.requestBody, { color: c.textSecondary }]}>
              Accept to start chatting — they can’t send you more messages until you do.
            </Text>
            <View style={styles.requestActions}>
              <Pressable
                onPress={() => decide(true)}
                disabled={deciding}
                accessibilityRole="button"
                accessibilityLabel="Accept message request"
                style={({ pressed }) => [
                  styles.requestBtn,
                  { backgroundColor: c.cta, opacity: pressed || deciding ? 0.75 : 1 },
                ]}
              >
                <Text style={[styles.requestBtnText, { color: c.ctaText }]}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => decide(false)}
                disabled={deciding}
                accessibilityRole="button"
                accessibilityLabel="Decline message request"
                style={({ pressed }) => [
                  styles.requestBtn,
                  styles.requestGhost,
                  { borderColor: c.border, opacity: pressed || deciding ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.requestBtnText, { color: c.textSecondary }]}>Decline</Text>
              </Pressable>
            </View>
          </View>
        )}

        {declined && (
          <View style={[styles.requestBar, { backgroundColor: c.backgroundElement, borderColor: c.border }]}>
            <Text style={[styles.requestBody, { color: c.textSecondary }]}>
              {iAmRequester
                ? "This person hasn't accepted your message request."
                : 'You declined this request. You can still accept it to start chatting.'}
            </Text>
            {!iAmRequester && (
              <View style={styles.requestActions}>
                <Pressable
                  onPress={() => decide(true)}
                  disabled={deciding}
                  accessibilityRole="button"
                  accessibilityLabel="Accept message request"
                  style={({ pressed }) => [
                    styles.requestBtn,
                    { backgroundColor: c.cta, opacity: pressed || deciding ? 0.75 : 1 },
                  ]}
                >
                  <Text style={[styles.requestBtnText, { color: c.ctaText }]}>Accept</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {canWrite && conv?.status === 'pending' && (
          <Text style={[styles.pendingNote, { color: c.textFaint }]}>
            Message request sent — they can reply once they accept.
          </Text>
        )}

        {/* Composer */}
        {canWrite && (
        <View style={[styles.composer, { borderColor: c.border, backgroundColor: c.backgroundElement }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={c.textFaint}
            style={[styles.input, { color: c.text }]}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            multiline
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            style={[
              styles.sendBtn,
              { backgroundColor: draft.trim() ? c.cta : c.backgroundSelected },
            ]}
          >
            <Ionicons name="arrow-up" size={18} color={draft.trim() ? c.ctaText : c.textFaint} />
          </Pressable>
        </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: Spacing.one },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.mono, fontSize: 12 },
  name: { flex: 1, fontSize: 16, fontFamily: Fonts.sansSemiBold },
  body: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: Spacing.three, gap: Spacing.two },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
  },
  bubbleText: { fontSize: 15, fontFamily: Fonts.sans, lineHeight: 21 },
  errorBar: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one + 2,
  },
  requestBar: {
    margin: Spacing.two + Spacing.one,
    marginBottom: Spacing.one,
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.one + 2,
  },
  requestTitle: { fontSize: 14.5, fontFamily: Fonts.sansSemiBold },
  requestBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
  requestActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  requestBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    minHeight: 40,
    justifyContent: 'center',
  },
  requestGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  requestBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  pendingNote: {
    fontSize: 12,
    fontFamily: Fonts.sans,
    textAlign: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    margin: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: Spacing.three,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 15, fontFamily: Fonts.sans, maxHeight: 110, paddingVertical: 4 },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
