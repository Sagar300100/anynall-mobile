// 1:1 message thread — conversations/{id}/messages. Marks the thread read on
// open and on every incoming batch, mirrors the web Messages page behaviour.
// Both participants can always write — same as the web client (older docs may
// carry a leftover mobile-only `status` field; it is ignored).
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
  markConversationRead,
  sendThreadMessage,
  subscribeThreadMessages,
  type ChatMessage,
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
  const listRef = useRef<FlatList<ChatMessage>>(null);

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

        {/* Composer */}
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
