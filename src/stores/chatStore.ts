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
    // Грубая оценка: ~4 символа на токен (для рус/англ) + 4 токена overhead на сообщение
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

    // System prompt всегда первый и не обрезается
    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt });
      tokenBudget += estimateTokens(systemPrompt);
    }

    // User Facts — глобальная база знаний, инжектится после system prompt
    if (userFacts) {
      result.push({
        role: 'system',
        content: `[Global facts known about the user, use this info when relevant]\n${userFacts}`,
      });
      tokenBudget += estimateTokens(userFacts) + 16;
    }

    // Rolling summary — вставляется после system prompt как контекст всей истории
    if (summary) {
      result.push({
        role: 'system',
        content: `[Краткое содержание предыдущего диалога]\n${summary}`,
      });
      tokenBudget += estimateTokens(summary) + 16;
    }

    // Собираем user/assistant с конца, пока не превысим лимит
    const eligible: { role: 'user' | 'assistant'; content: string }[] = [];
    messagesArr.forEach((m) => {
      if (m.role === 'user' || (m.role === 'assistant' && m.content !== '')) {
        eligible.push({ role: m.role, content: m.content });
      }
    });

    // Идём с конца, собираем пока укладываемся в бюджет
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
    // Скрываем пустое assistant-сообщение во время стриминга —
    // вместо него показывается спиннер в шаблоне
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
      title: title || 'Новый чат',
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
      // Если есть другие сессии — переключаемся на первую
      if (sessions.value.length > 0) {
        await selectSession(sessions.value[0].id);
      } else {
        currentSessionId.value = null;
        messages.value = [];
      }
    }
  }

  // --- Summary ---

  const SUMMARY_TRIGGER_COUNT = 20; // каждые 20 user/assistant обменов

  async function maybeSummarize() {
    const session = sessions.value.find((s) => s.id === currentSessionId.value);
    if (!session) {
      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Пропуск: нет активной сессии');
      return;
    }
    if (!session.summaryEnabled) {
      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Пропуск: summaryEnabled выключен');
      return;
    }

    const userAssistantMsgs = messages.value.filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );
    // Триггерим когда накопилось кратно SUMMARY_TRIGGER_COUNT новых сообщений
    // (т.е. 20, 40, 60, ...)
    const nextTrigger = SUMMARY_TRIGGER_COUNT;
    if (userAssistantMsgs.length % nextTrigger !== 0) {
      // eslint-disable-next-line no-console
      console.log(`[maybeSummarize] Пропуск: ${userAssistantMsgs.length} сообщений, ближайший триггер на ${Math.ceil(userAssistantMsgs.length / nextTrigger) * nextTrigger}`);
      return;
    }

    const settings = useSettingsStore();
    await settings.load();
    if (!settings.apiKey) return;

    isSummarizing.value = true;

    try {
      const prevSummary = session.summary
        ? `Предыдущее саммари:\n${session.summary}\n\n---\n`
        : '';

      // Берём последние N сообщений для обновления саммари
      const recentBatch = userAssistantMsgs.slice(-SUMMARY_TRIGGER_COUNT);
      const dialogueText = recentBatch
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const summaryModel = settings.summaryModel || settings.model;

      const prompt = `Ты — ассистент, который составляет краткое содержание диалога.
${prevSummary}Новые сообщения:
${dialogueText}

Составь обновлённое краткое содержание всего диалога (сохрани ключевую информацию из предыдущего саммари и новых сообщений). Пиши на том же языке, на котором идёт диалог. Будь краток: не более 500 слов.`;

      // eslint-disable-next-line no-console
      console.log('[maybeSummarize] Генерация саммари, модель:', summaryModel);
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
        console.log('[maybeSummarize] Саммари обновлено, длина:', newSummary.length);
      }

      // --- Extract / update User Facts ---
      // Берём полный набор user/assistant сообщений для более широкого контекста
      const allUserAssistant = messages.value.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      );
      if (allUserAssistant.length > 0 && settings.userFacts !== undefined) {
        try {
          const prevFacts = settings.userFacts
            ? `Текущие известные факты о пользователе:\n${settings.userFacts}\n\n---\n`
            : '';

          const factsPrompt = `Ты — ассистент, который ведёт "базу знаний" о пользователе (User Facts). Извлеки из диалога факты, которые влияют на будущие решения или имеют долгосрочную ценность: имя, предпочтения, питомцы, проекты, технологии, привычки, важные события, контекст работы и т.д.

**Критерий отбора:** факт должен сохраняться, только если он влияет на будущие решения или имеет долгосрочную ценность.
✅ Пример факта: «Есть рыжий кот Лала, сдох примерно в мае 2025» — это долгосрочная информация о питомце.
❌ Не факт: «Сегодня настроение паршивое» — временное состояние, не влияет на будущие диалоги.

${prevFacts}Последний диалог:
${dialogueText}

Обнови список фактов (сохрани старые, добавь новые, исправь противоречащие). Пиши на том же языке, что и диалог. Формат: маркдаун, краткие пункты. Не включай временные настроения, однодневные планы и тривиальную информацию.`;

          // eslint-disable-next-line no-console
          console.log('[maybeSummarize] Извлечение User Facts, модель:', summaryModel);
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
            console.log('[maybeSummarize] User Facts обновлены, длина:', newFacts.length);

            // Показываем уведомление в чате
            factsNotification.value = newFacts.trim();
          }
        } catch (factsErr) {
          // eslint-disable-next-line no-console
          console.warn('[maybeSummarize] Ошибка извлечения фактов:', factsErr);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[maybeSummarize] Ошибка генерации саммари:', err);
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
    // При отключении очищаем существующее саммари
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
      error.value = 'API-ключ не задан. Откройте настройки (шестерёнка) и введите ключ.';
      return;
    }

    // Авто-создаём сессию если нет активной
    if (!currentSessionId.value) {
      await createSession(text.slice(0, 50));
    }

    const sid = currentSessionId.value as string;
    const now = Date.now();
    error.value = null;

    // 1. Добавляем user-сообщение
    const userMsg: Message = {
      sessionId: sid,
      role: 'user',
      content: text,
      createdAt: now,
    };
    const userId = await putMessage(userMsg);
    userMsg.id = userId;
    messages.value.push(userMsg);

    // Авто-заголовок для новой сессии (по первому сообщению)
    const session = sessions.value.find((s) => s.id === sid);
    if (session && session.title === 'Новый чат') {
      await renameSession(sid, text.slice(0, 50));
    }

    // Обновляем updatedAt сессии
    if (session) {
      session.updatedAt = now;
      await putSession({ ...toRaw(session) });
    }

    // 2. Создаём пустое assistant-сообщение
    const assistantMsg: Message = {
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
    };
    const assistantId = await putMessage(assistantMsg);
    assistantMsg.id = assistantId;
    messages.value.push(assistantMsg);

    // 3. Формируем payload для API (с обрезкой по токенам из настроек)
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

    // 4. Стриминг
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

    // Удаляем все сообщения после редактируемого (из IndexedDB)
    const removed = messages.value.splice(idx + 1);
    await Promise.all(removed.map((m) => {
      if (m.id) return deleteMessage(m.id);
      return undefined;
    }));

    // Обновляем текст редактируемого сообщения
    messages.value[idx].content = newText;
    if (messages.value[idx].id) {
      await putMessage({ ...toRaw(messages.value[idx]) });
    }

    // Отправляем как новое — без создания нового user-сообщения
    const settings = useSettingsStore();
    await settings.load();

    if (!settings.apiKey) {
      error.value = 'API-ключ не задан.';
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
    // Формируем payload с обрезкой по токенам из настроек
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
