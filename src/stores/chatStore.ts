import { defineStore } from 'pinia';
import { ref, computed, toRaw } from 'vue';
import {
  type Message,
  type Session,
  getAllSessions,
  getMessages,
  putSession,
  putMessage,
  deleteSession,
  deleteMessage,
} from 'src/services/db';
import { streamChat, chat, type LlmMessage } from 'src/services/llmProvider';
import { useSettingsStore } from './settingsStore';

export { type Message, type Session };

export const useChatStore = defineStore('chat', () => {
  // --- State ---
  const sessions = ref<Session[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);
  const isSummarizing = ref(false);
  const factsNotification = ref<string | null>(null);

  let abortController: AbortController | null = null;

  // --- Token budget helpers ---

  function estimateTokens(content: string): number {
    // Rough estimate: ~4 chars per token (for en/ru) + 4 tokens overhead per message
    return Math.ceil(content.length / 4) + 4;
  }

  function buildTrimmedMessages(
    messagesArr: Message[],
    systemPrompt?: string,
    summary?: string,
    userFacts?: string,
    maxTokens?: number,
  ): LlmMessage[] {
    const limit = maxTokens || 200000;
    const result: LlmMessage[] = [];
    let tokenBudget = 0;

    // System prompt always first and never trimmed
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
      tokenBudget += estimateTokens(systemPrompt);
    }

    // User Facts — global knowledge base, injected after system prompt
    if (userFacts) {
      result.push({
        role: 'system',
        content: `[Global facts known about the user, use this info when relevant]\n${userFacts}`,
      });
      tokenBudget += estimateTokens(userFacts) + 16;
    }

    // Rolling summary — inserted after system prompt as conversation history context
    if (summary) {
      result.push({
        role: 'system',
        content: `[Summary of the conversation so far]\n${summary}`,
      });
      tokenBudget += estimateTokens(summary) + 16;
    }

    // Collect user/assistant from the end, until we exceed the limit
    const eligible: { role: 'user' | 'assistant'; content: string }[] = [];
    messagesArr.forEach((m) => {
      if (m.role === 'user' || (m.role === 'assistant' && m.content !== '')) {
        eligible.push({ role: m.role, content: m.content });
      }
    });

    // Walk from the end, keep messages while within budget
    const kept: typeof eligible = [];
    for (let i = eligible.length - 1; i >= 0; i -= 1) {
      const cost = estimateTokens(eligible[i].content);
      // eslint-disable-next-line no-continue
      if (tokenBudget + cost > limit) continue;
      kept.unshift(eligible[i]);
      tokenBudget += cost;
    }

    kept.forEach((m) => result.push(m));

    // eslint-disable-next-line no-console
    console.log('[buildTrimmedMessages] ~tokens:', tokenBudget,
      '/', limit, 'messages:', result.length);

    return result;
  }

  // --- Getters ---
  const currentSession = computed(
    () => sessions.value.find(
      (s) => s.id === currentSessionId.value,
    ) ?? null,
  );

  const displayMessages = computed(() => messages.value.filter((m) => {
    if (m.role === 'system') return false;
    // Hide empty assistant message during streaming —
    // a spinner is shown in the template instead
    if (m.role === 'assistant' && !m.content && isStreaming.value) {
      return false;
    }
    return true;
  }));

  // --- Session management ---

  async function loadSessions() {
    sessions.value = await getAllSessions();
  }

  async function selectSession(id: string) {
    currentSessionId.value = id;
    error.value = null;
    messages.value = await getMessages(id);
  }

  async function createSession(title?: string): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      title: title || 'New Chat',
      createdAt: now,
      updatedAt: now,
    };
    await putSession(session);
    sessions.value.unshift(session);
    return selectSession(id).then(() => id);
  }

  async function renameSession(id: string, title: string) {
    const session = sessions.value.find((s) => s.id === id);
    if (!session) return;
    session.title = title;
    session.updatedAt = Date.now();
    await putSession({ ...toRaw(session) });
  }

  async function updateSystemPrompt(prompt: string | undefined) {
    const session = sessions.value.find(
      (s) => s.id === currentSessionId.value,
    );
    if (!session) return;
    session.systemPrompt = prompt;
    session.updatedAt = Date.now();
    await putSession({ ...toRaw(session) });
  }

  async function removeSession(id: string) {
    await deleteSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    if (currentSessionId.value === id) {
      // If there are other sessions — switch to the first one
      if (sessions.value.length > 0) {
        await selectSession(sessions.value[0].id);
      } else {
        currentSessionId.value = null;
        messages.value = [];
      }
    }
  }

  // --- Summary ---

  const SUMMARY_TRIGGER_COUNT = 20; // every 20 user/assistant exchanges

  async function maybeSummarize() {
    const session = sessions.value.find((s) => s.id === currentSessionId.value);
    if (!session) {
      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Skip: no active session');
      return;
    }
    if (!session.summaryEnabled) {
      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Skip: summaryEnabled is off');
      return;
    }

    const userAssistantMsgs = messages.value.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );
    // Trigger when we've accumulated a multiple of SUMMARY_TRIGGER_COUNT new messages
    // (i.e. 20, 40, 60, ...)
    const nextTrigger = SUMMARY_TRIGGER_COUNT;
    if (userAssistantMsgs.length % nextTrigger !== 0) {
      // eslint-disable-next-line no-console
      console.log(`[maybeSummarize] Skip: ${userAssistantMsgs.length} messages, next trigger at ${Math.ceil(userAssistantMsgs.length / nextTrigger) * nextTrigger}`);
      return;
    }

    const settings = useSettingsStore();
    await settings.load();
    if (!settings.apiKey) return;

    isSummarizing.value = true;

    try {
      const prevSummary = session.summary
        ? `Previous summary:\n${session.summary}\n\n---\n`
        : '';

      // Take the last N messages for summary update
      const recentBatch = userAssistantMsgs.slice(-SUMMARY_TRIGGER_COUNT);
      const dialogueText = recentBatch
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const summaryModel = settings.summaryModel || settings.model;

      const prompt = `You are an assistant that writes conversation summaries.
${prevSummary}New messages:
${dialogueText}

Write an updated summary of the entire conversation (preserve key information from the previous summary and new messages). Write in the same language as the conversation. Be concise: no more than 500 words.`;

      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Generating summary, model:', summaryModel);
      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Payload →', JSON.stringify({
        endpoint: settings.endpoint,
        model: summaryModel,
        promptLength: prompt.length,
        prevSummaryLength: session.summary?.length ?? 0,
        recentMessages: recentBatch.length,
        totalUserAssistant: userAssistantMsgs.length,
      }, null, 2));

      const newSummary = await chat(
        {
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          model: summaryModel,
          messages: [{ role: 'user', content: prompt }],
        },
      );

      if (newSummary) {
        session.summary = newSummary.trim();
        session.updatedAt = Date.now();
        await putSession({ ...toRaw(session) });

        // eslint-disable-next-line no-console
        console.log('[maybeSummarize] Summary updated, length:', newSummary.length);
      }

      // --- Extract / update User Facts ---
      // Take the full set of user/assistant messages for broader context
      const allUserAssistant = messages.value.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      );
      if (allUserAssistant.length > 0 && settings.userFacts !== undefined) {
        try {
          const prevFacts = settings.userFacts
            ? `Current known facts about the user:\n${settings.userFacts}\n\n---\n`
            : '';

          const factsPrompt = `You are an assistant that maintains a "knowledge base" about the user (User Facts). Extract facts from the conversation that influence future decisions or have long-term value: name, preferences, pets, projects, technologies, habits, important events, work context, etc.

**Selection criteria:** a fact should be kept only if it influences future decisions or has long-term value.
✅ Example of a fact: "Has a ginger cat named Lala, died around May 2025" — this is long-term information about a pet.
❌ Not a fact: "I'm in a bad mood today" — a temporary state, does not affect future conversations.

${prevFacts}Latest conversation:
${dialogueText}

Update the facts list (keep old ones, add new ones, correct contradictions). Write in the same language as the conversation. Format: markdown, concise bullet points. Do not include temporary moods, one-day plans, or trivial information.`;

          // eslint-disable-next-line no-console
          console.log('[maybeSummarize] Extracting User Facts, model:', summaryModel);
          // eslint-disable-next-line no-console
          console.log('[maybeSummarize] Facts payload →', JSON.stringify({
            endpoint: settings.endpoint,
            model: summaryModel,
            promptLength: factsPrompt.length,
            prevFactsLength: settings.userFacts.length,
            recentMessages: recentBatch.length,
          }, null, 2));

          const newFacts = await chat(
            {
              endpoint: settings.endpoint,
              apiKey: settings.apiKey,
              model: summaryModel,
              messages: [{ role: 'user', content: factsPrompt }],
            },
          );

          if (newFacts) {
            await settings.saveUserFacts(newFacts.trim());

            // eslint-disable-next-line no-console
            console.log('[maybeSummarize] User Facts updated, length:', newFacts.length);

            // Show notification in chat
            factsNotification.value = newFacts.trim();
          }
        } catch (factsErr) {
          // eslint-disable-next-line no-console
          console.warn('[maybeSummarize] Error extracting facts:', factsErr);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[maybeSummarize] Error generating summary:', err);
    } finally {
      isSummarizing.value = false;
    }
  }

  async function updateSummaryEnabled(enabled: boolean) {
    const session = sessions.value.find(
      (s) => s.id === currentSessionId.value,
    );
    if (!session) return;
    session.summaryEnabled = enabled;
    session.updatedAt = Date.now();
    // Clear existing summary when disabling
    if (!enabled) {
      session.summary = undefined;
    }
    await putSession({ ...toRaw(session) });
  }

  // --- Messaging ---

  async function sendMessage(text: string) {
    const settings = useSettingsStore();
    await settings.load();

    if (!settings.apiKey) {
      error.value = 'API key not set. Open Settings (gear icon) and enter your key.';
      return;
    }

    // Auto-create session if none is active
    if (!currentSessionId.value) {
      await createSession(text.slice(0, 50));
    }

    const sid = currentSessionId.value as string;
    const now = Date.now();
    error.value = null;

    // 1. Add user message
    const userMsg: Message = {
      sessionId: sid,
      role: 'user',
      content: text,
      createdAt: now,
    };
    const userId = await putMessage(userMsg);
    userMsg.id = userId;
    messages.value.push(userMsg);

    // Auto-title for new session (from first message)
    const session = sessions.value.find((s) => s.id === sid);
    if (session && session.title === 'New Chat') {
      await renameSession(sid, text.slice(0, 50));
    }

    // Update session updatedAt
    if (session) {
      session.updatedAt = now;
      await putSession({ ...toRaw(session) });
    }

    // 2. Create empty assistant message
    const assistantMsg: Message = {
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
    };
    const assistantId = await putMessage(assistantMsg);
    assistantMsg.id = assistantId;
    messages.value.push(assistantMsg);

    // 3. Build API payload (with token trimming from settings)
    const llmMessages = buildTrimmedMessages(
      messages.value,
      session?.systemPrompt,
      session?.summary,
      settings.userFacts,
      settings.tokenLimit,
    );

    // eslint-disable-next-line no-console
    console.log('[sendMessage] Payload →', JSON.stringify({
      endpoint: settings.endpoint,
      model: settings.model,
      messages: llmMessages,
    }, null, 2));

    // 4. Streaming
    isStreaming.value = true;
    abortController = new AbortController();

    const idx = messages.value.findIndex((m) => m.id === assistantId);

    try {
      await streamChat(
        {
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          model: settings.model,
          messages: llmMessages,
        },
        {
          onChunk(delta: string) {
            if (idx >= 0) {
              messages.value[idx].content += delta;
            }
          },
          onDone() {
            if (idx >= 0) {
              void putMessage({ ...toRaw(messages.value[idx]) });
            }
            void maybeSummarize();
          },
          onError(err: Error) {
            error.value = err.message;
            if (idx >= 0 && !messages.value[idx].content) {
              messages.value.splice(idx, 1);
            }
          },
        },
        abortController.signal,
      );
    } finally {
      isStreaming.value = false;
      abortController = null;
    }
  }

  function cancelStream() {
    abortController?.abort();
    isStreaming.value = false;
  }

  async function editMessage(messageId: number, newText: string) {
    const idx = messages.value.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    // Delete all messages after the edited one (from IndexedDB)
    const removed = messages.value.splice(idx + 1);
    await Promise.all(removed.map((m) => {
      if (m.id) return deleteMessage(m.id);
      return undefined;
    }));

    // Update the edited message text
    messages.value[idx].content = newText;
    if (messages.value[idx].id) {
      await putMessage({ ...toRaw(messages.value[idx]) });
    }

    // Send as new — without creating a new user message
    const settings = useSettingsStore();
    await settings.load();

    if (!settings.apiKey) {
      error.value = 'API key not set.';
      return;
    }

    const sid = currentSessionId.value as string;
    error.value = null;

    const assistantMsg: Message = {
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    const assistantId = await putMessage(assistantMsg);
    assistantMsg.id = assistantId;
    messages.value.push(assistantMsg);

    const session = sessions.value.find((s) => s.id === sid);
    // Build payload with token trimming from settings
    const llmMessages = buildTrimmedMessages(
      messages.value,
      session?.systemPrompt,
      session?.summary,
      settings.userFacts,
      settings.tokenLimit,
    );

    // eslint-disable-next-line no-console
    console.log('[editMessage] Payload →', JSON.stringify({
      endpoint: settings.endpoint,
      model: settings.model,
      messages: llmMessages,
    }, null, 2));

    isStreaming.value = true;
    abortController = new AbortController();

    const aidx = messages.value.findIndex((m) => m.id === assistantId);

    try {
      await streamChat(
        {
          endpoint: settings.endpoint,
          apiKey: settings.apiKey,
          model: settings.model,
          messages: llmMessages,
        },
        {
          onChunk(delta: string) {
            if (aidx >= 0) messages.value[aidx].content += delta;
          },
          onDone() {
            if (aidx >= 0) {
              void putMessage({ ...toRaw(messages.value[aidx]) });
            }
            void maybeSummarize();
          },
          onError(err: Error) {
            error.value = err.message;
            if (aidx >= 0 && !messages.value[aidx].content) {
              messages.value.splice(aidx, 1);
            }
          },
        },
        abortController.signal,
      );
    } finally {
      isStreaming.value = false;
      abortController = null;
    }
  }

  // --- Initialization ---

  async function init() {
    await loadSessions();
    if (sessions.value.length > 0) {
      await selectSession(sessions.value[0].id);
    }
  }

  return {
    // state
    sessions,
    currentSessionId,
    messages,
    isStreaming,
    error,
    // getters
    currentSession,
    displayMessages,
    // summary
    isSummarizing,
    factsNotification,
    maybeSummarize,
    updateSummaryEnabled,
    // session actions
    loadSessions,
    createSession,
    selectSession,
    renameSession,
    removeSession,
    updateSystemPrompt,
    // message actions
    sendMessage,
    cancelStream,
    editMessage,
    // init
    init,
  };
});
