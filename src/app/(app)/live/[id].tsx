import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
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
import { sendMessage, subscribeMessages, type ChatDoc } from '@/lib/chat';
import { useSession } from '@/lib/session';
import { useShows } from '@/hooks/use-shows';

export default function LiveRoomScreen() {
  const c = useBrandColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const { shows } = useShows();
  const show = shows.find((s) => String(s.id) === String(id));

  const [messages, setMessages] = useState<ChatDoc[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatDoc>>(null);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = subscribeMessages(String(id), setMessages);
    return unsubscribe;
  }, [id]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(String(id), {
        user: user?.displayName || user?.email?.split('@')[0] || 'buyer',
        text,
      });
    } catch {
      setDraft(text); // give the text back on failure
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* Video stage — LiveKit playback lands with the dev build; until then
          the show thumbnail is the backdrop so the room is already usable. */}
      <View style={styles.stage}>
        {show?.thumbnail ? (
          <Image source={{ uri: show.thumbnail }} style={styles.stageImage} contentFit="cover" />
        ) : (
          <View style={[styles.stageImage, { backgroundColor: c.backgroundElement }]} />
        )}
        <View style={styles.stageOverlay} />
      </View>

      <SafeAreaView style={styles.content} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {show?.isLive && (
              <View style={[styles.livePill, { backgroundColor: c.live }]}>
                <Text style={styles.livePillText}>LIVE</Text>
              </View>
            )}
            <View style={styles.headerText}>
              <Text numberOfLines={1} style={[styles.title, { color: c.text }]}>
                {show?.name ?? 'Live show'}
              </Text>
              <Text numberOfLines={1} style={[styles.seller, { color: c.textSecondary }]}>
                @{show?.seller ?? 'seller'}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.back()}
            style={[styles.closeBtn, { backgroundColor: 'rgba(5,10,24,0.65)' }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={c.text} />
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Chat feed */}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => String(i)}
            style={styles.chatList}
            contentContainerStyle={styles.chatContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => (
              <View style={styles.msgRow}>
                <View style={[styles.msgAvatar, { backgroundColor: c.backgroundSelected }]}>
                  <Text style={[styles.msgAvatarText, { color: c.primary }]}>
                    {(item.avatar || item.user.slice(0, 2)).toUpperCase().slice(0, 2)}
                  </Text>
                </View>
                <View style={styles.msgBody}>
                  <Text style={[styles.msgUser, { color: c.textSecondary }]}>{item.user}</Text>
                  <Text style={[styles.msgText, { color: c.text }]}>{item.text}</Text>
                </View>
              </View>
            )}
          />

          {/* Composer */}
          <View style={[styles.composer, { borderColor: c.border, backgroundColor: 'rgba(10,20,40,0.85)' }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Say something…"
              placeholderTextColor={c.textFaint}
              style={[styles.input, { color: c.text }]}
              onSubmitEditing={handleSend}
              returnKeyType="send"
            />
            <Pressable
              onPress={handleSend}
              disabled={!draft.trim() || sending}
              style={[
                styles.sendBtn,
                { backgroundColor: draft.trim() ? c.cta : c.backgroundSelected },
              ]}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={draft.trim() ? c.ctaText : c.textFaint}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  stageImage: { width: '100%', height: '100%' },
  stageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5,10,24,0.55)',
  },
  content: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    gap: Spacing.three,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  livePill: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 3 },
  livePillText: { color: '#fff', fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5 },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  seller: { fontSize: 12, fontFamily: Fonts.sans },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatArea: { flex: 1, justifyContent: 'flex-end' },
  chatList: { maxHeight: '55%', flexGrow: 0 },
  chatContent: { padding: Spacing.three, gap: Spacing.two + Spacing.one },
  msgRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarText: { fontFamily: Fonts.mono, fontSize: 10 },
  msgBody: { flex: 1 },
  msgUser: { fontSize: 11, fontFamily: Fonts.sansMedium },
  msgText: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 19 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    margin: Spacing.three,
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: Spacing.three,
    paddingRight: 6,
    paddingVertical: 6,
  },
  input: { flex: 1, fontSize: 15, fontFamily: Fonts.sans, paddingVertical: 4 },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
