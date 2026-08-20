// Support Assistant — mobile port of the website's components/AgentChat.tsx
// against the grounded agent (functions/supportAgentRouter.js).
//
// The reply streams token-by-token (src/lib/support-agent.ts), each answer is
// grounded in Help Center / policy sources shown as chips beneath it, and the
// SERVER decides when a conversation needs a human — the meta trailer's
// `escalate` flag opens the in-line ticket card, which files through
// POST /api/support/escalate with the full transcript attached.
//
// Signed-in only, mirroring the web: the backend requires auth + verified
// email, and escalation takes the trusted name/email from Auth — never from
// anything typed here. Guests get the standard prompt, not a broken chat.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@/components/guest-prompt';
import { useBrandColors } from '@/components/ui/form';
import { Fonts, Spacing } from '@/constants/theme';
import { useAuthStatus } from '@/lib/auth-gate';
import {
  streamSupportAgent,
  type AgentMessage,
  type AgentStream,
  type SupportMeta,
} from '@/lib/support-agent';
import {
  CATEGORY_LABEL,
  escalateSupport,
  sendSupportFeedback,
  type EscalationReason,
  type TicketCategory,
} from '@/lib/support';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** Set once the stream completes; carries sources + the escalate signal. */
  meta?: SupportMeta;
  /** Feedback vote already cast on this answer (one vote per answer). */
  voted?: 'helpful' | 'unhelpful';
}

type TicketState =
  | { step: 'none' }
  | { step: 'form'; reason: EscalationReason; category: TicketCategory }
  | { step: 'submitting'; reason: EscalationReason; category: TicketCategory }
  | { step: 'done'; reference: string; status: string; category: TicketCategory };

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL) as [TicketCategory, string][];

const GREETING =
  'Hi! I’m the Any&All support assistant. I can help with orders, payments, refunds, returns, delivery, live shows, and account questions — what’s going on?';

/** Module scope on purpose: Date.now/Math.random are impure, and the purity
 *  lint refuses them anywhere inside the component — even on a path only an
 *  event handler reaches. */
function mintSessionId(): string {
  return `mob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SupportChatScreen() {
  const c = useBrandColors();
  const status = useAuthStatus();

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketState>({ step: 'none' });
  const [orderId, setOrderId] = useState('');
  // "Didn't help" votes this conversation — the first earns a retry, the
  // second goes to a human (web parity: components/AgentChat.tsx).
  const [failCount, setFailCount] = useState(0);

  // Stable per-conversation id so repeated escalations update ONE ticket.
  // Minted lazily on first use, never during render.
  const sessionIdRef = useRef<string | null>(null);
  function getSessionId() {
    if (!sessionIdRef.current) sessionIdRef.current = mintSessionId();
    return sessionIdRef.current;
  }

  const scrollRef = useRef<ScrollView>(null);
  const streamRef = useRef<AgentStream | null>(null);

  // Abandoning the screen mid-answer must kill the request.
  useEffect(() => () => streamRef.current?.cancel(), []);

  function scrollToEnd() {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  /** Stream one assistant turn for `history`. The caller has already appended
   *  the user turn and the empty assistant bubble to `messages`. */
  async function runTurn(history: AgentMessage[]) {
    setError(null);
    setBusy(true);

    const stream = streamSupportAgent(history, (delta) => {
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
      const meta = await stream.promise;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], meta };
        return next;
      });
      if (meta.escalate) {
        setTicket({
          step: 'form',
          reason: (meta.reason as EscalationReason) || 'no_source_found',
          category: (meta.category as TicketCategory) || 'other',
        });
      }
      scrollToEnd();
    } catch (err) {
      // Remove the empty bubble; the error banner explains what happened.
      setMessages((prev) =>
        prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1].content
          ? prev.slice(0, -1)
          : prev
      );
      setError(err instanceof Error ? err.message : 'The assistant is unavailable right now.');
      // Web parity: a dead assistant is itself a reason to reach a human —
      // offer the ticket rather than leaving the user talking to an error
      // banner. Never stomps a form already in flight.
      setTicket((t) =>
        t.step === 'none' ? { step: 'form', reason: 'upstream_error', category: 'other' } : t
      );
    } finally {
      streamRef.current = null;
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');

    const history: AgentMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ];
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ]);
    scrollToEnd();
    await runTurn(history);
  }

  function vote(index: number, verdict: 'helpful' | 'unhelpful') {
    const answer = messages[index];
    if (!answer || answer.voted) return;
    // The question is the user turn right before this answer.
    const question = messages[index - 1]?.content || '';
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, voted: verdict } : m)));
    // Fire-and-forget by design — a failed vote must never interrupt the chat.
    sendSupportFeedback(question, verdict === 'helpful').catch(() => {});
    if (verdict !== 'unhelpful') return;

    // Web parity: the FIRST miss earns one improved attempt with the question
    // restated; the second — or a high-risk topic — goes to a human, with the
    // honest reason on the ticket.
    const failures = failCount + 1;
    setFailCount(failures);
    const highRisk = !!answer.meta?.highRisk;
    if (failures >= 2 || highRisk) {
      if (ticket.step === 'none') {
        setTicket({
          step: 'form',
          reason: failures >= 2 ? 'repeated_failure' : 'didnt_help',
          category: 'other',
        });
      }
      return;
    }
    if (busy) return; // a vote on an older answer mid-stream must not fork the chat
    const retry = `That didn't fully answer it. Please take another careful look at the sources and answer again more specifically. My question was: ${question}`;
    const history: AgentMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: retry },
    ];
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: retry },
      { role: 'assistant', content: '' },
    ]);
    scrollToEnd();
    runTurn(history);
  }

  async function fileTicket() {
    if (ticket.step !== 'form') return;
    const { reason, category } = ticket;
    setTicket({ step: 'submitting', reason, category });
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      // Web parity: doc name + title + URL, so the support team can open the
      // exact source the assistant answered from — a bare title isn't
      // traceable.
      const sources = messages
        .flatMap((m) => m.meta?.sources ?? [])
        .map((s) => `${s.doc} — ${s.title}${s.url ? ` (${s.url})` : ''}`)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 8);
      const res = await escalateSupport({
        sessionId: getSessionId(),
        category,
        subject: (lastUser?.content || 'Support request from assistant').slice(0, 180),
        summary: (lastUser?.content || '').slice(0, 1200),
        reason,
        orderId: orderId.trim() || undefined,
        page: 'mobile/support-chat',
        sources,
        transcript: messages
          .filter((m) => m.content)
          .map((m) => ({ role: m.role, content: m.content })),
      });
      setTicket({
        step: 'done',
        reference: res.ticketNumber ? `#${res.ticketNumber}` : res.reference,
        status: res.status,
        category,
      });
      scrollToEnd();
    } catch (err) {
      setTicket({ step: 'form', reason, category });
      setError(err instanceof Error ? err.message : 'Could not create the ticket.');
    }
  }

  if (status === 'loading') {
    return <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']} />;
  }
  if (status === 'guest') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <TopBar />
        <GuestPrompt
          icon="sparkles-outline"
          title="Sign in to use the assistant"
          body="The assistant answers from your account — orders, payments, tickets — so it needs to know who you are."
          reason="profile"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <TopBar />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Standing greeting — rendered, not sent, so it never joins the transcript. */}
          <Bubble role="assistant" text={GREETING} />

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <Bubble key={i} role="user" text={m.content} />
            ) : (
              <View key={i} style={styles.assistantBlock}>
                <Bubble role="assistant" text={m.content} streaming={busy && i === messages.length - 1} />
                {!!m.meta?.sources.length && (
                  <View style={styles.sources}>
                    {m.meta.sources.map((s) => (
                      <View key={s.title} style={[styles.sourceChip, { borderColor: c.border }]}>
                        <Ionicons name="document-text-outline" size={11} color={c.textFaint} />
                        <Text style={[styles.sourceText, { color: c.textFaint }]} numberOfLines={1}>
                          {s.title}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Feedback appears once the answer is complete and only on
                    grounded answers — voting on an escalation prompt is noise. */}
                {!!m.meta && !m.meta.escalate && !!m.content && (
                  <View style={styles.feedback}>
                    {m.voted ? (
                      <Text style={[styles.votedText, { color: c.textFaint }]}>
                        {m.voted === 'helpful' ? 'Thanks for the feedback' : 'Noted — let’s get you a human'}
                      </Text>
                    ) : (
                      <>
                        <FeedbackBtn icon="thumbs-up-outline" label="Helpful" onPress={() => vote(i, 'helpful')} />
                        <FeedbackBtn icon="thumbs-down-outline" label="Didn’t help" onPress={() => vote(i, 'unhelpful')} />
                      </>
                    )}
                  </View>
                )}
              </View>
            )
          )}

          {error && (
            <View style={[styles.errorBox, { borderColor: 'rgba(229,72,77,0.25)' }]}>
              <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
            </View>
          )}

          {/* ── In-line escalation card ── */}
          {(ticket.step === 'form' || ticket.step === 'submitting') && (
            <View style={[styles.ticketCard, { backgroundColor: c.cardBackground, borderColor: c.borderStrong }]}>
              <Text style={[styles.ticketTitle, { color: c.text }]}>Create a support ticket</Text>
              <Text style={[styles.ticketBody, { color: c.textSecondary }]}>
                This conversation gets attached so the team picks up right where we left off.
              </Text>
              <View style={styles.optionWrap}>
                {CATEGORY_OPTIONS.map(([key, label]) => {
                  const active = ticket.category === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setTicket({ ...ticket, category: key })}
                      disabled={ticket.step === 'submitting'}
                      accessibilityRole="button"
                      accessibilityLabel={label}
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.option,
                        active ? { backgroundColor: c.cta, borderColor: c.cta } : { borderColor: c.border },
                      ]}
                    >
                      <Text style={[styles.optionText, { color: active ? c.ctaText : c.textSecondary }]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={orderId}
                onChangeText={setOrderId}
                placeholder="Order / payment / show ID (optional)"
                placeholderTextColor={c.textFaint}
                accessibilityLabel="Order, payment or show ID"
                editable={ticket.step === 'form'}
                style={[
                  styles.ticketInput,
                  { backgroundColor: c.backgroundElement, borderColor: c.border, color: c.text },
                ]}
              />
              <View style={styles.ticketActions}>
                <Pressable
                  onPress={fileTicket}
                  disabled={ticket.step === 'submitting'}
                  accessibilityRole="button"
                  accessibilityLabel="Create ticket"
                  style={({ pressed }) => [
                    styles.ticketBtn,
                    { backgroundColor: c.cta, opacity: pressed || ticket.step === 'submitting' ? 0.75 : 1 },
                  ]}
                >
                  {ticket.step === 'submitting' ? (
                    <ActivityIndicator size="small" color={c.ctaText} />
                  ) : (
                    <Text style={[styles.ticketBtnText, { color: c.ctaText }]}>Create ticket</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setTicket({ step: 'none' })}
                  disabled={ticket.step === 'submitting'}
                  accessibilityRole="button"
                  accessibilityLabel="Not now"
                  style={({ pressed }) => [
                    styles.ticketBtn,
                    styles.ticketGhost,
                    { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.ticketBtnText, { color: c.textSecondary }]}>Not now</Text>
                </Pressable>
              </View>
            </View>
          )}

          {ticket.step === 'done' && (
            <View style={[styles.ticketCard, { backgroundColor: c.cardBackground, borderColor: 'rgba(74,222,128,0.35)' }]}>
              <View style={styles.doneRow}>
                <Ionicons name="checkmark-circle" size={18} color="#4ade80" />
                <Text style={[styles.ticketTitle, { color: c.text }]}>Ticket {ticket.reference} created</Text>
              </View>
              <Text style={[styles.ticketBody, { color: c.textSecondary }]}>
                {CATEGORY_LABEL[ticket.category]} · Status: {ticket.status}. Replies arrive at your
                registered email — track it under My Tickets.
              </Text>
              <Pressable
                onPress={() => router.push('/my-tickets')}
                accessibilityRole="button"
                accessibilityLabel="View my tickets"
                hitSlop={6}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={[styles.myTicketsLink, { color: c.primary }]}>View my tickets</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* ── Composer ── */}
        <View style={[styles.composer, { borderTopColor: c.border, backgroundColor: c.background }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about orders, refunds, shows…"
            placeholderTextColor={c.textFaint}
            accessibilityLabel="Message the assistant"
            multiline
            style={[
              styles.input,
              { backgroundColor: c.backgroundElement, borderColor: c.border, color: c.text },
            ]}
          />
          <Pressable
            onPress={send}
            disabled={busy || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: input.trim() && !busy ? c.cta : c.backgroundElement,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={c.textSecondary} />
            ) : (
              <Ionicons
                name="arrow-up"
                size={19}
                color={input.trim() ? c.ctaText : c.textFaint}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TopBar() {
  const c = useBrandColors();
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/help'))}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={10}
        style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="arrow-back" size={22} color={c.text} />
      </Pressable>
      <View style={styles.topText}>
        <Text style={[styles.topTitle, { color: c.text }]}>Support Assistant</Text>
        <Text style={[styles.topSub, { color: c.textFaint }]}>
          Answers from Any&All policies · can raise tickets
        </Text>
      </View>
    </View>
  );
}

function Bubble({
  role,
  text,
  streaming = false,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}) {
  const c = useBrandColors();
  const user = role === 'user';
  // An empty assistant bubble while waiting for the first token reads as a
  // typing indicator, not a blank message.
  const showTyping = !user && !text && streaming;
  return (
    <View
      style={[
        styles.bubble,
        user
          ? [styles.bubbleUser, { backgroundColor: c.backgroundSelected }]
          : [styles.bubbleAssistant, { backgroundColor: c.cardBackground, borderColor: c.border }],
      ]}
    >
      {showTyping ? (
        <ActivityIndicator size="small" color={c.textSecondary} />
      ) : (
        <Text style={[styles.bubbleText, { color: c.text }]}>{text}</Text>
      )}
    </View>
  );
}

function FeedbackBtn({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const c = useBrandColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.feedbackBtn, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={13} color={c.textSecondary} />
      <Text style={[styles.feedbackText, { color: c.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  topText: { flex: 1, gap: 1 },
  topTitle: { fontSize: 17, fontFamily: Fonts.sansSemiBold },
  topSub: { fontSize: 11.5, fontFamily: Fonts.sans },

  scroll: { padding: Spacing.three, paddingTop: Spacing.one, gap: Spacing.two },

  bubble: { maxWidth: '86%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 5 },
  bubbleAssistant: { alignSelf: 'flex-start', borderWidth: 1, borderBottomLeftRadius: 5 },
  bubbleText: { fontSize: 14.5, fontFamily: Fonts.sans, lineHeight: 21 },

  assistantBlock: { gap: Spacing.one + 2 },
  sources: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2, maxWidth: '86%' },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sourceText: { fontSize: 10.5, fontFamily: Fonts.sansMedium, maxWidth: 180 },

  feedback: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  feedbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    minHeight: 32,
  },
  feedbackText: { fontSize: 11.5, fontFamily: Fonts.sansMedium },
  votedText: { fontSize: 11.5, fontFamily: Fonts.sans },

  errorBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    backgroundColor: 'rgba(229,72,77,0.08)',
  },
  errorText: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },

  ticketCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  ticketTitle: { fontSize: 15, fontFamily: Fonts.sansSemiBold },
  ticketBody: { fontSize: 13, fontFamily: Fonts.sans, lineHeight: 19 },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one + 2 },
  option: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    justifyContent: 'center',
  },
  optionText: { fontSize: 12, fontFamily: Fonts.sansMedium },
  ticketInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.sans,
  },
  ticketActions: { flexDirection: 'row', gap: Spacing.two },
  ticketBtn: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three + Spacing.one,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketGhost: { backgroundColor: 'transparent', borderWidth: 1 },
  ticketBtnText: { fontSize: 13, fontFamily: Fonts.sansMedium },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  myTicketsLink: { fontSize: 13, fontFamily: Fonts.sansMedium, paddingVertical: 4 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: Spacing.three,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14.5,
    fontFamily: Fonts.sans,
    maxHeight: 110,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
