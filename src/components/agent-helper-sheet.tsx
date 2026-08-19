// Contextual AI helper — a reusable bottom-sheet chat over the secure LLM
// gateway (lib/agent). The website's floating assistant switches to a
// seller-onboarding helper and a live-show helper depending on where you
// are; this brings the same contextual help to the app:
//
//   <AgentHelperSheet agentId="live-show" …>        (broadcast studio)
//   <AgentHelperSheet agentId="seller-onboarding" …> (KYC wizard)
//
// Same server enforcement as every agent call: auth + App Check + verified
// email + the per-user daily token budget. Streaming, cancellable on close.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { streamAgent, type AgentMessage, type AgentStream } from '@/lib/agent';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

export function AgentHelperSheet({
  visible,
  onClose,
  agentId,
  title,
  intro,
  placeholder,
}: {
  visible: boolean;
  onClose: () => void;
  /** Server-side agent id: 'live-show' | 'seller-onboarding' | … */
  agentId: string;
  title: string;
  /** Rendered greeting — never sent to the model. */
  intro: string;
  placeholder: string;
}) {
  const c = useBrandColors();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const streamRef = useRef<AgentStream | null>(null);

  // Closing the sheet kills any in-flight request.
  useEffect(() => {
    if (!visible) streamRef.current?.cancel();
  }, [visible]);
  useEffect(() => () => streamRef.current?.cancel(), []);

  function scrollToEnd() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setError(null);
    setBusy(true);

    const history: AgentMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    scrollToEnd();

    const stream = streamAgent(agentId, history, (delta) => {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      });
      scrollToEnd();
    });
    streamRef.current = stream;

    try {
      await stream.promise;
    } catch (err) {
      setMessages((prev) =>
        prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content
          ? prev.slice(0, -1)
          : prev
      );
      setError(err instanceof Error ? err.message : 'The helper is unavailable right now.');
    } finally {
      streamRef.current = null;
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.sheet, { backgroundColor: c.backgroundElement, borderColor: c.borderStrong }]}>
            <View style={styles.head}>
              <Ionicons name="sparkles-outline" size={17} color={c.primary} />
              <Text style={[styles.title, { color: c.text }]}>{title}</Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close helper"
                hitSlop={8}
              >
                <Ionicons name="close" size={20} color={c.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.bubble, styles.bubbleAssistant, { backgroundColor: c.cardBackground, borderColor: c.border }]}>
                <Text style={[styles.bubbleText, { color: c.text }]}>{intro}</Text>
              </View>
              {messages.map((m, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    m.role === 'user'
                      ? [styles.bubbleUser, { backgroundColor: c.backgroundSelected }]
                      : [styles.bubbleAssistant, { backgroundColor: c.cardBackground, borderColor: c.border }],
                  ]}
                >
                  {m.role === 'assistant' && !m.content && busy && i === messages.length - 1 ? (
                    <ActivityIndicator size="small" color={c.textSecondary} />
                  ) : (
                    <Text selectable style={[styles.bubbleText, { color: c.text }]}>
                      {m.content}
                    </Text>
                  )}
                </View>
              ))}
              {!!error && <Text style={[styles.error, { color: c.danger }]}>{error}</Text>}
            </ScrollView>

            <View style={[styles.composer, { borderColor: c.border, backgroundColor: c.background }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={placeholder}
                placeholderTextColor={c.textFaint}
                accessibilityLabel={placeholder}
                multiline
                style={[styles.input, { color: c.text }]}
              />
              <Pressable
                onPress={send}
                disabled={busy || !draft.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send"
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: draft.trim() && !busy ? c.cta : c.backgroundSelected, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={c.textSecondary} />
                ) : (
                  <Ionicons name="arrow-up" size={17} color={draft.trim() ? c.ctaText : c.textFaint} />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(2,6,16,0.7)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    maxHeight: '86%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three + Spacing.one,
    paddingVertical: Spacing.three,
  },
  title: { flex: 1, fontSize: 15.5, fontFamily: Fonts.sansSemiBold },

  body: { maxHeight: 420 },
  bodyContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two, gap: Spacing.two },
  bubble: { maxWidth: '88%', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 5 },
  bubbleAssistant: { alignSelf: 'flex-start', borderWidth: 1, borderBottomLeftRadius: 5 },
  bubbleText: { fontSize: 14, fontFamily: Fonts.sans, lineHeight: 20 },
  error: { fontSize: 12.5, fontFamily: Fonts.sans, lineHeight: 18 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    paddingBottom: Spacing.three + Spacing.one,
  },
  input: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: Fonts.sans,
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
