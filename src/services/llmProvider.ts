export interface LlmMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamCallbacks {
  // eslint-disable-next-line no-unused-vars
  onChunk: (delta: string) => void;
  // eslint-disable-next-line no-unused-vars
  onReasoning?: (text: string) => void;
  // eslint-disable-next-line no-unused-vars
  onDone: (fullContent: string) => void;
  // eslint-disable-next-line no-unused-vars
  onError: (error: Error) => void;
}

export interface ChatParams {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
}

interface SseChoice {
  delta?: {
    // eslint-disable-next-line camelcase
    content?: string;
    // eslint-disable-next-line camelcase
    reasoning_content?: string;
  };
}

interface SseChunk {
  choices?: SseChoice[];
}

/**
 * Универсальный OpenAI-совместимый стриминговый клиент.
 * Работает с DeepSeek, OpenAI, и любыми прокси/API, поддерживающими
 * формат chat/completions с stream: true.
 */
export async function streamChat(
  params: ChatParams,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${params.endpoint.replace(/\/+$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errBody}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep last partial line in buffer
      buffer = lines.pop() || '';

      for (let li = 0; li < lines.length; li += 1) {
        const line = lines[li];
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue; // eslint-disable-line no-continue

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          callbacks.onDone(fullContent);
          return;
        }

        try {
          const chunk = JSON.parse(data) as SseChunk;
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue; // eslint-disable-line no-continue

          if (delta.reasoning_content) {
            callbacks.onReasoning?.(delta.reasoning_content);
          }
          if (delta.content) {
            fullContent += delta.content;
            callbacks.onChunk(delta.content);
          }
        } catch {
          // Пропускаем строки с невалидным JSON
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Нормальная отмена — всё что накопили уже отдали
      return;
    }
    callbacks.onError(err as Error);
    return;
  }

  callbacks.onDone(fullContent);
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Не-стриминговый вызов (для авто-заголовков и т.п.)
 */
export async function chat(
  params: ChatParams,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${params.endpoint.replace(/\/+$/, '')}/chat/completions`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errBody}`);
  }

  const data = (await response.json()) as ChatResponse;
  return data.choices?.[0]?.message?.content ?? '';
}
