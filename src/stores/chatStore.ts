import { defineStore } from 'pinia';
import { ref, computed, toRaw } from 'vue';
import {
  type Message,
  type Session,
  type AttachmentMeta,
  getAllSessions,
  getMessages,
  putSession,
  putMessage,
  deleteSession,
  deleteMessage,
} from 'src/services/db';
import { streamChat, chat, type LlmMessage } from 'src/services/llmProvider';
import { searchWeb, formatSearchResults } from 'src/services/searchProvider';
import { type ParseResult } from 'src/services/fileParser';
import { syncService } from 'src/services/syncService';
import { useSettingsStore } from './settingsStore';

export { type Message, type Session };

export const useChatStore = defineStore('chat', () => {
  // --- State ---
  const sessions = ref<Session[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isStreaming = ref(false);
  const isSearching = ref(false);
  const error = ref<string | null>(null);
  const isSummarizing = ref(false);
  const factsNotification = ref<string[] | null>(null);

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
    userFacts?: string[],
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
    if (userFacts && userFacts.length > 0) {
      const factsText = userFacts.map((f) => `- ${f}`).join('\n');
      result.push({
        role: 'system',
        content: `[Global facts known about the user, use this info when relevant]\n${factsText}`,
      });
      tokenBudget += estimateTokens(factsText) + 16;
    }

    // Rolling summary — inserted after system prompt as conversation history context
    if (summary) {
      result.push({
        role: 'system',
        content: `[Summary of the conversation so far]\n${summary}`,
      });
      tokenBudget += estimateTokens(summary) + 16;
    }

    // Collect user/assistant/searchResult from the end, until we exceed the limit.
    // searchResult messages are mapped to 'user' role for the LLM API.
    const eligible: { role: 'user' | 'assistant'; content: string }[] = [];
    messagesArr.forEach((m) => {
      if (m.role === 'searchResult') {
        eligible.push({ role: 'user', content: m.content });
      } else if (m.role === 'user' || (m.role === 'assistant' && m.content !== '')) {
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

  /**
   * Detect a tool call JSON in the response text.
   * Returns { query } if a search tool call is found, null otherwise.
   */
  function detectToolCall(text: string): { query: string } | null {
    // Only match when the ENTIRE response is a JSON tool call, not mixed with text.
    // Trim and verify it starts with { and ends with }.
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        typeof parsed === 'object'
        && parsed !== null
        && 'search' in parsed
        && typeof (parsed as Record<string, unknown>).search === 'string'
        && ((parsed as Record<string, string>).search).length > 0
      ) {
        return { query: (parsed as Record<string, string>).search };
      }
    } catch {
      // Not valid JSON — ignore
    }
    return null;
  }

  /**
   * Build system prompt extension with search tool instruction.
   */
  function searchSystemPrompt(): string {
    const now = new Date();
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const todayRu = now.toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    return `[WEB SEARCH TOOL — MANDATORY RULES]

Current date: ${today} (${todayRu}).

You have access to a web search tool. When you need up-to-date information, respond with ONLY a JSON object (no other text):
{"search":"your search query here"}

CRITICAL RULES:
1. Your response MUST be ONLY valid JSON — not a single character before or after the braces.
2. MANDATORY search triggers (you MUST search, no exceptions):
   - Keywords: «новости», «news», «сейчас», «now», «сегодня», «today», «последние», «latest»
   - Any question about the current date, weather, stock prices, sports scores, recent events
   - ANY question requiring real-world facts you cannot know from training data
3. SEARCH QUERY FORMAT:
   - ALWAYS include the current year (${now.getFullYear()}) in search queries for recent/current information
   - Example: «новости» → {"search":"новости ${now.getFullYear()}"}
   - Example: «погода» → {"search":"погода Москва ${today}"}
4. FORBIDDEN:
   - NEVER invent weather, news, prices, dates, or any real-time data
   - NEVER guess «tomorrow's weather» or «today's news» — search instead
   - If unsure whether data is current → search

After you respond with the JSON, you will receive search results. Then give the user a complete answer based on those results.`;
  }

  const displayMessages = computed(() => messages.value.filter((m) => {
    if (m.role === 'system' || m.role === 'searchResult') return false;
    // Hide empty assistant messages
    if (m.role === 'assistant' && !m.content && !m.reasoning) {
      return false;
    }
    // Hide assistant tool-call JSON (both partial during stream and complete)
    if (m.role === 'assistant' && m.content.trimStart().startsWith('{')) {
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
    // Save last active session
    try {
      localStorage.setItem('chatgpt-last-session', id);
    } catch {
      // ignore
    }
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
    syncService.enqueueSync(id);
  }

  async function updateSystemPrompt(prompt: string | undefined) {
    const session = sessions.value.find(
      (s) => s.id === currentSessionId.value,
    );
    if (!session) return;
    session.systemPrompt = prompt;
    session.updatedAt = Date.now();
    await putSession({ ...toRaw(session) });
    if (currentSessionId.value) {
      syncService.enqueueSync(currentSessionId.value);
    }
  }

  async function removeSession(id: string) {
    await deleteSession(id);
    sessions.value = sessions.value.filter((s) => s.id !== id);
    // Delete from Drive
    void syncService.deleteSessionFile(id);
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

        // Sync after summary update
        if (currentSessionId.value) {
          syncService.enqueueSync(currentSessionId.value);
        }
      }

      // --- Extract / update User Facts ---
      try {
        const existingFacts = settings.userFacts;
        const prevFactsBlock = existingFacts.length > 0
          ? `- ${existingFacts.join('\n- ')}\n\n---\n`
          : '';

        const factsPrompt = `Ты — строгий фильтр фактов. Твоя задача — вести минимальную базу знаний о пользователе.

ГЛАВНОЕ ПРАВИЛО: в 90% случаев ты не должен добавлять НИЧЕГО. Большинство диалогов не содержат информации, ценной в долгосрочной перспективе.

Факт добавляется, только если выполнены ВСЕ три условия:
1. Эта информация будет важна в разговоре через 3 месяца
2. Без неё будущие ответы были бы ХУЖЕ
3. Эту информацию нельзя понять из текущего контекста диалога

Когда ДОБАВЛЯЕМ (РЕДКО — только если пользователь явно сообщил):
- «Работает с TypeScript + Vue 3» — влияет на примеры кода
- «Аллергия на арахис» — влияет на рекомендации еды
- «Живёт в Берлине» — влияет на часовой пояс, локацию

Когда НЕ ДОБАВЛЯЕМ (99% случаев):
- Настроение, планы на день, временные ситуации
- Технический вопрос, который прямо сейчас обсуждается
- Мнения, которые могут измениться («Мне кажется X лучше Y»)
- Детали проекта, если не сказано явно что это надолго
- Всё, что пользователь не назвал фактом о себе

ФОРМАТ ОТВЕТА: каждая строка — один факт. Один факт = одно предложение не длиннее 120 символов.
Верни полный обновлённый список (старые факты + новые).
Если добавлять нечего — верни существующий список без изменений.
Факты должны быть на том же языке, что и диалог.

Существующие факты:
${prevFactsBlock}
Последний диалог:
${dialogueText}`;

        // eslint-disable-next-line no-console
        console.log('[maybeSummarize] Extracting User Facts, model:', summaryModel);
        // eslint-disable-next-line no-console
        console.log('[maybeSummarize] Facts payload →', JSON.stringify({
          endpoint: settings.endpoint,
          model: summaryModel,
          promptLength: factsPrompt.length,
          prevFactsCount: existingFacts.length,
          recentMessages: recentBatch.length,
        }, null, 2));

        const rawFacts = await chat(
          {
            endpoint: settings.endpoint,
            apiKey: settings.apiKey,
            model: summaryModel,
            messages: [{ role: 'user', content: factsPrompt }],
          },
        );

        if (rawFacts) {
          // Parse response: split by newlines, strip bullets, filter, deduplicate
          const parsedFacts = rawFacts
            .split('\n')
            .map((line) => line.replace(/^[-*•]\s*/, '').trim())
            .filter((line) => line.length > 0 && line.length <= 200)
            .filter((line, idx, arr) => arr.indexOf(line) === idx); // dedup

          if (parsedFacts.length > 0) {
            // Only count as "changed" if the list actually differs
            const prevJson = JSON.stringify(existingFacts);
            const newJson = JSON.stringify(parsedFacts);
            const hasChanges = prevJson !== newJson;

            await settings.saveUserFacts(parsedFacts);

            // Sync user facts after update
            if (currentSessionId.value) {
              syncService.enqueueSync(currentSessionId.value);
            }

            // eslint-disable-next-line no-console
            console.log('[maybeSummarize] User Facts updated, count:', parsedFacts.length,
              hasChanges ? '(changed)' : '(unchanged)');

            // Show notification only if facts actually changed
            if (hasChanges) {
              const newOnes = parsedFacts.filter(
                (f: string) => !existingFacts.some(
                  (ef: string) => ef.toLowerCase() === f.toLowerCase(),
                ),
              );
              factsNotification.value = newOnes.length > 0
                ? newOnes
                : parsedFacts;
            }
          }
        }
      } catch (factsErr) {
        // eslint-disable-next-line no-console
        console.warn('[maybeSummarize] Error extracting facts:', factsErr);
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

  const MAX_TOOL_ROUNDS = 3;

  async function streamWithToolLoop(
    settings: ReturnType<typeof useSettingsStore>,
    sessionId: string,
    initialMessages: LlmMessage[],
    assistantIdx: number,
    streamModel?: string,
  ): Promise<void> {
    const model = streamModel || settings.model;
    let round = 0;

    /* eslint-disable no-await-in-loop, no-loop-func */
    while (round < MAX_TOOL_ROUNDS) {
      isStreaming.value = true;
      abortController = new AbortController();

      await new Promise<void>((resolve) => {
        void streamChat(
          {
            endpoint: settings.endpoint,
            apiKey: settings.apiKey,
            model,
            messages: initialMessages,
          },
          {
            onChunk(delta: string) {
              if (assistantIdx >= 0) {
                messages.value[assistantIdx].content += delta;
              }
            },
            onReasoning(reasoning: string) {
              if (assistantIdx >= 0) {
                if (!messages.value[assistantIdx].reasoning) {
                  messages.value[assistantIdx].reasoning = '';
                }
                messages.value[assistantIdx].reasoning += reasoning;
              }
            },
            onDone() {
              // Check if the response is a tool call
              const text = messages.value[assistantIdx]?.content || '';
              // eslint-disable-next-line no-console
              // console.log('[LLM Response]', text);
              const tool = detectToolCall(text);

              if (tool) {
                // Trigger tool execution below (outside this promise)
                abortController = null;
                isStreaming.value = false;
                resolve();
                return;
              }

              // Normal completion
              if (assistantIdx >= 0) {
                void putMessage({ ...toRaw(messages.value[assistantIdx]) });
              }
              void maybeSummarize();
              abortController = null;
              isStreaming.value = false;
              resolve();
            },
            onError(err: Error) {
              error.value = err.message;
              if (assistantIdx >= 0 && !messages.value[assistantIdx].content
                && !messages.value[assistantIdx].reasoning) {
                messages.value.splice(assistantIdx, 1);
              }
              abortController = null;
              isStreaming.value = false;
              resolve();
            },
          },
          abortController!.signal,
        );
      });

      // After stream ends, check for tool call
      if (!settings.searchEnabled || !settings.searchApiKey) break;

      const text = messages.value[assistantIdx]?.content || '';
      const tool = detectToolCall(text);

      if (!tool) break; // No tool call — done

      round += 1;

      // Execute search
      // eslint-disable-next-line no-console
      console.log(`[tool] Searching for: "${tool.query}"`);
      isSearching.value = true;

      try {
        // eslint-disable-next-line no-await-in-loop
        const results = await searchWeb(tool.query, settings.searchApiKey);
        const formatted = formatSearchResults(results);

        // eslint-disable-next-line no-console
        console.log('[tool] Search results:', results.results.length, 'items');

        // Completely remove the tool-call assistant message (not shown to user).
        // Its JSON and reasoning are only for tool detection, not UI.
        if (messages.value[assistantIdx].id) {
          // eslint-disable-next-line no-await-in-loop
          await deleteMessage(messages.value[assistantIdx].id!);
        }
        messages.value.splice(assistantIdx, 1);

        // Add search result as a searchResult message.
        // Hidden from UI, mapped to 'user' role in buildTrimmedMessages for the LLM API.
        const searchResultMsg: Message = {
          uuid: crypto.randomUUID(),
          sessionId,
          role: 'searchResult',
          content: `[Search results for "${tool.query}"]:\n${formatted}`,
          createdAt: Date.now(),
        };
        // eslint-disable-next-line no-await-in-loop
        await putMessage(searchResultMsg);
        messages.value.push(searchResultMsg);

        // Add new assistant message for the final response (carries searchMeta)
        const newMsg: Message = {
          uuid: crypto.randomUUID(),
          sessionId,
          role: 'assistant',
          content: '',
          searchMeta: {
            query: tool.query,
            resultsCount: results.results.length,
          },
          createdAt: Date.now(),
        };
        // eslint-disable-next-line no-await-in-loop
        const newId = await putMessage(newMsg);
        newMsg.id = newId;
        messages.value.push(newMsg);
        assistantIdx = messages.value.findIndex((m) => m.id === newId);

        // Rebuild payload for next round, preserving the search tool prompt
        const session = sessions.value.find((s) => s.id === sessionId);
        initialMessages = buildTrimmedMessages(
          messages.value,
          undefined,
          session?.summary,
          settings.userFacts,
          settings.tokenLimit,
        );
        // Re-insert search tool instruction (may be needed if LLM needs another search)
        const searchPrompt = searchSystemPrompt();
        const systemMsgs2: LlmMessage[] = [];
        if (session?.systemPrompt) {
          systemMsgs2.push({ role: 'system', content: session.systemPrompt });
        }
        systemMsgs2.push({ role: 'system', content: searchPrompt });
        initialMessages = [
          ...systemMsgs2,
          ...initialMessages.filter((m) => m.role !== 'system'),
        ];
      } catch (searchErr) {
        error.value = `Search error: ${(searchErr as Error).message}`;
        // eslint-disable-next-line no-console
        console.warn('[tool] Search error:', searchErr);
        break;
      } finally {
        isSearching.value = false;
      }
    }
    /* eslint-enable no-await-in-loop, no-loop-func */
  }

  async function sendMessage(text: string, parsedFiles?: ParseResult[]) {
    // eslint-disable-next-line no-console
    console.log('[chatStore] sendMessage: ts=', Date.now(), 'text="', text, '" parsedFiles=', parsedFiles?.map((f) => ({ name: f.name, len: f.text.length })));
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

    // Build attachments meta and the content block for LLM
    const attachmentMetas: AttachmentMeta[] = [];
    const imageDataUrls: string[] = [];
    let filesContentText = '';

    if (parsedFiles && parsedFiles.length > 0) {
      parsedFiles.forEach((f) => {
        if (f.dataUrl) {
          attachmentMetas.push({ name: f.name, type: 'image/png', size: f.size });
          imageDataUrls.push(f.dataUrl);
        } else {
          attachmentMetas.push({ name: f.name, type: 'text/plain', size: f.size });
          filesContentText += `[Attached file: ${f.name}]\n${f.text}\n\n`;
        }
      });
      if (filesContentText) {
        filesContentText += '---\n';
      }
    }

    const hasImages = imageDataUrls.length > 0;

    // 1. Add user message (only metadata saved, not file content)
    const userMsg: Message = {
      uuid: crypto.randomUUID(),
      sessionId: sid,
      role: 'user',
      content: text,
      attachments: attachmentMetas.length > 0 ? attachmentMetas : undefined,
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
      uuid: crypto.randomUUID(),
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
    };
    const assistantId = await putMessage(assistantMsg);
    assistantMsg.id = assistantId;
    messages.value.push(assistantMsg);

    const idx = messages.value.findIndex((m) => m.id === assistantId);

    // 3. Build API payload with search prompt if enabled
    const searchPrompt = settings.searchEnabled && settings.searchApiKey
      ? searchSystemPrompt()
      : '';

    const systemMsgs: LlmMessage[] = [];
    if (session?.systemPrompt) {
      systemMsgs.push({ role: 'system', content: session.systemPrompt });
    }
    if (searchPrompt) {
      systemMsgs.push({ role: 'system', content: searchPrompt });
    }

    // Build payload using raw messages but prepend system messages
    // eslint-disable-next-line no-console
    console.log('[chatStore] filesContentText len=', filesContentText.length);
    let llmMessages = buildTrimmedMessages(
      messages.value,
      undefined, // system prompt handled above
      session?.summary,
      settings.userFacts,
      settings.tokenLimit,
    );

    // If files are attached, inject their content before the last user message
    if (filesContentText && llmMessages.length > 0) {
      const lastUser = llmMessages.filter((m) => m.role === 'user').pop();
      if (lastUser) {
        // eslint-disable-next-line no-param-reassign
        lastUser.content = filesContentText + (lastUser.content as string);
      }
    }

    // If images are attached and vision enabled, convert last user message to vision format
    const streamModel = hasImages && settings.visionEnabled
      ? (settings.visionModel || settings.model)
      : settings.model;

    if (hasImages && settings.visionEnabled) {
      const lastUser = llmMessages.filter((m) => m.role === 'user').pop();
      if (lastUser) {
        const textContent = typeof lastUser.content === 'string'
          ? lastUser.content
          : '';
        /* eslint-disable camelcase */
        const contentParts: Array<
          { type: 'text'; text: string }
          | { type: 'image_url'; image_url: { url: string } }
        > = [
          ...imageDataUrls.map((url) => ({
            type: 'image_url' as const,
            image_url: { url },
          })),
        ];
        /* eslint-enable camelcase */
        if (textContent) {
          contentParts.push({ type: 'text' as const, text: textContent });
        }
        lastUser.content = contentParts;
      }
    }

    llmMessages = [...systemMsgs, ...llmMessages.filter((m) => m.role !== 'system')];

    // eslint-disable-next-line no-console
    console.log('[sendMessage] Payload →', JSON.stringify({
      endpoint: settings.endpoint,
      model: streamModel,
      messages: llmMessages,
    }, null, 2));

    // 4. Stream with tool loop — pass matched model
    await streamWithToolLoop(settings, sid, llmMessages, idx, streamModel);

    // Log final assistant response
    const lastMsg = messages.value.length > 0 ? messages.value[messages.value.length - 1] : null;
    if (lastMsg && lastMsg.role === 'assistant') {
      // eslint-disable-next-line no-console
      // console.log('[LLM Final]', lastMsg.content);
    }

    // Sync after message is sent
    syncService.enqueueSync(sid);
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
      uuid: crypto.randomUUID(),
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    };
    const assistantId = await putMessage(assistantMsg);
    assistantMsg.id = assistantId;
    messages.value.push(assistantMsg);

    const session = sessions.value.find((s) => s.id === sid);

    // Build API payload with search prompt if enabled
    const searchPrompt = settings.searchEnabled && settings.searchApiKey
      ? searchSystemPrompt()
      : '';

    const systemMsgs: LlmMessage[] = [];
    if (session?.systemPrompt) {
      systemMsgs.push({ role: 'system', content: session.systemPrompt });
    }
    if (searchPrompt) {
      systemMsgs.push({ role: 'system', content: searchPrompt });
    }

    let llmMessages = buildTrimmedMessages(
      messages.value,
      undefined,
      session?.summary,
      settings.userFacts,
      settings.tokenLimit,
    );
    llmMessages = [...systemMsgs, ...llmMessages.filter((m) => m.role !== 'system')];

    // eslint-disable-next-line no-console
    console.log('[editMessage] Payload →', JSON.stringify({
      endpoint: settings.endpoint,
      model: settings.model,
      messages: llmMessages,
    }, null, 2));

    // Stream with tool loop
    const editAidx = messages.value.findIndex((m) => m.id === assistantId);
    await streamWithToolLoop(settings, sid, llmMessages, editAidx);

    // Sync after edit
    syncService.enqueueSync(sid);
  }

  // --- Initialization ---

  async function init() {
    await loadSessions();
    if (sessions.value.length > 0) {
      // Try to restore last active session
      const lastId = localStorage.getItem('chatgpt-last-session');
      if (lastId && sessions.value.some((s) => s.id === lastId)) {
        await selectSession(lastId);
      } else {
        await selectSession(sessions.value[0].id);
      }
    }
  }

  return {
    // state
    sessions,
    currentSessionId,
    messages,
    isStreaming,
    isSearching,
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
