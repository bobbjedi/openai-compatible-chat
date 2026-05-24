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
import { streamChat, type LlmMessage } from 'src/services/llmProvider';
import { useSettingsStore } from './settingsStore';

export { type Message, type Session };

export const useChatStore = defineStore('chat', () => {
  // --- State ---
  const sessions = ref<Session[]>([]);
  const currentSessionId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);

  let abortController: AbortController | null = null;

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

    // 3. Формируем payload для API
    const llmMessages: LlmMessage[] = messages.value
      .filter((m) => m.role === 'user' || m.content !== '')
      .map((m) => ({ role: m.role, content: m.content }));

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

    const llmMessages: LlmMessage[] = messages.value
      .filter((m) => m.role === 'user' || m.content !== '')
      .map((m) => ({ role: m.role, content: m.content }));

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
    // session actions
    loadSessions,
    createSession,
    selectSession,
    renameSession,
    removeSession,
    // message actions
    sendMessage,
    cancelStream,
    editMessage,
    // init
    init,
  };
});
