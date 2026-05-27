/**
 * Step-by-Step Voice Mode — semi-automatic voice mode.
 *
 * State cycle:
 *   idle → listening → thinking → speaking → idle → ...
 *
 * Microphone listens continuously until user taps send.
 * After send — message goes to LLM, streaming TTS sentence by sentence.
 *
 * Reuses:
 * - speechRecognition.ts for recognition
 * - chatStore.sendMessage() for sending
 * - SpeechSynthesis for TTS
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { ref, watch } from 'vue';
import { useChatStore } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { speechRecognition } from './speechRecognition';

// --- Types ---

export type StepVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

// --- State ---

export const stepVoiceState = {
  isActive: ref(false),
  state: ref<StepVoiceState>('idle'),
  transcript: ref(''),
  responseText: ref(''),
};

// --- Internal vars ---

let accumulatedText = '';
// eslint-disable-next-line prefer-const
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;

// --- Streaming TTS ---

let ttsQueue: string[] = [];
let isSpeaking = false;
let lastProcessedLength = 0;
let unwatchMessages: (() => void) | null = null;
let unwatchStreaming: (() => void) | null = null;
// eslint-disable-next-line prefer-const
let pendingBuffer = '';

// --- TTS (declared before processQueue) ---

function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();

    const cleanText = text
      .replace(/[#*_`[\]()>|~]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();

    if (!cleanText) {
      resolve();
      return;
    }

    const settings = useSettingsStore();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ru-RU';
    utterance.rate = settings.ttsRate;
    utterance.pitch = 1.0;

    utterance.onend = () => { resolve(); };
    utterance.onerror = () => { resolve(); };

    window.speechSynthesis.speak(utterance);
  });
}

// --- Watch cleanup (declared before startStreamingTTS) ---

function cleanupStreamWatches() {
  if (unwatchMessages) {
    unwatchMessages();
    unwatchMessages = null;
  }
  if (unwatchStreaming) {
    unwatchStreaming();
    unwatchStreaming = null;
  }
}

// --- Sentence parsing ---

function parseSentences(text: string): string[] {
  const raw = text
    .split(/(?<=[.!?])\s+|(?<=\n)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  // Merge continuations (starting with lowercase) with previous sentence
  const result: string[] = [];
  raw.forEach((s) => {
    if (result.length > 0 && /^[a-zа-я]/.test(s)) {
      result[result.length - 1] += ` ${s}`;
    } else {
      result.push(s);
    }
  });
  return result;
}

// --- TTS queue ---

async function processQueue() {
  if (isSpeaking || ttsQueue.length === 0) return;
  isSpeaking = true;

  const sentence = ttsQueue.shift()!;
  stepVoiceState.responseText.value += `${sentence} `;
  stepVoiceState.state.value = 'speaking';

  // eslint-disable-next-line no-console
  console.log('[StepVoice] TTS sending: "', sentence, '" queue remaining:', ttsQueue.length);
  await speakText(sentence);

  isSpeaking = false;

  if (ttsQueue.length > 0) {
    processQueue();
  } else {
    const chatStore = useChatStore();
    if (!chatStore.isStreaming) {
      stepVoiceState.state.value = 'idle';
    }
  }
}

function onNewContent(content: string) {
  const newPart = content.slice(lastProcessedLength);
  if (!newPart) {
    // eslint-disable-next-line no-console
    console.log('[StepVoice] onNewContent — no new content, totalLen=', content.length, 'processed=', lastProcessedLength);
    return;
  }

  lastProcessedLength = content.length;

  // Add to pending buffer and try to extract complete sentences
  pendingBuffer += newPart;
  // eslint-disable-next-line no-console
  console.log('[StepVoice] onNewContent — buffer: "', pendingBuffer.slice(0, 100), '"');

  const sentences = parseSentences(pendingBuffer);
  if (sentences.length > 0) {
    // Keep the last incomplete part in buffer (if any)
    const lastSentence = sentences[sentences.length - 1];
    const lastIdx = pendingBuffer.lastIndexOf(lastSentence);
    const afterLast = lastIdx + lastSentence.length;
    pendingBuffer = pendingBuffer.slice(afterLast).trim();

    // Push complete sentences to queue (all except possibly incomplete last one)
    const completeSentences = sentences.slice(0, -1);
    if (completeSentences.length > 0) {
      ttsQueue.push(...completeSentences);
      // eslint-disable-next-line no-console
      console.log('[StepVoice] onNewContent — queued', completeSentences.length, 'sentences, buffer remaining: "', pendingBuffer, '"');
      if (!isSpeaking) {
        processQueue();
      }
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('[StepVoice] onNewContent — no complete sentences yet, buffering...');
  }
}

// --- Streaming ---

function startStreamingTTS(text: string) {
  if (!text) return;

  // Clean up any previous watches
  cleanupStreamWatches();

  speechRecognition.stop();
  stepVoiceState.state.value = 'thinking';
  accumulatedText = '';
  ttsQueue = [];
  isSpeaking = false;
  lastProcessedLength = 0;
  pendingBuffer = '';
  stepVoiceState.responseText.value = '';

  const chatStore = useChatStore();
  const settings = useSettingsStore();

  if (!settings.apiKey) {
    stepVoiceState.state.value = 'idle';
    return;
  }

  if (!chatStore.currentSessionId) {
    chatStore.createSession(text.slice(0, 50));
  }

  chatStore.sendMessage(text);

  // Wait for streaming to start, then watch content of last assistant message
  unwatchStreaming = watch(
    () => chatStore.isStreaming,
    (streaming) => {
      if (streaming) {
        unwatchMessages = watch(
          () => {
            const msgs = chatStore.messages;
            for (let i = msgs.length - 1; i >= 0; i -= 1) {
              if (msgs[i].role === 'assistant') {
                return msgs[i].content || '';
              }
            }
            return '';
          },
          (content) => {
            if (content) {
              onNewContent(content);
            }
          },
        );
      } else {
        // Streaming ended — flush pending buffer
        if (pendingBuffer.trim()) {
          // eslint-disable-next-line no-console
          console.log('[StepVoice] flushing buffer: "', pendingBuffer, '"');
          ttsQueue.push(pendingBuffer.trim());
          pendingBuffer = '';
          if (!isSpeaking) {
            processQueue();
          }
        }
        if (ttsQueue.length === 0 && !isSpeaking) {
          stepVoiceState.state.value = 'idle';
        }
        cleanupStreamWatches();
      }
    },
  );
}

// --- Auto-send timeout ---

function scheduleAutoSend() {
  if (autoSendTimer) clearTimeout(autoSendTimer);
  const settings = useSettingsStore();
  const timeout = settings.stepVoiceTimeout;
  if (timeout > 0) {
    // eslint-disable-next-line no-console
    console.log('[StepVoice] auto-send timer started:', timeout, 'ms');
    autoSendTimer = setTimeout(() => {
      if (stepVoiceState.state.value === 'listening' && accumulatedText.trim()) {
        // eslint-disable-next-line no-console
        console.log('[StepVoice] auto-send FIRED after', timeout, 'ms');
        startStreamingTTS(accumulatedText.trim());
      } else {
        // eslint-disable-next-line no-console
        console.log('[StepVoice] auto-send skipped: state=', stepVoiceState.state.value, 'text="', accumulatedText, '"');
      }
    }, timeout);
  }
}

// --- Speech Recognition callbacks ---

function makeCallbacks() {
  return {
    onResult(text: string) {
      accumulatedText = accumulatedText
        ? `${accumulatedText} ${text}`
        : text;
      stepVoiceState.transcript.value = accumulatedText;
      // eslint-disable-next-line no-console
      console.log('[StepVoice] final phrase: "', text, '" total: "', accumulatedText, '"');
      scheduleAutoSend();
    },
    onInterim(text: string) {
      stepVoiceState.transcript.value = accumulatedText
        ? `${accumulatedText} ${text}`
        : text;
      scheduleAutoSend();
    },
    onError() {
      if (stepVoiceState.state.value === 'listening') {
        speechRecognition.start(makeCallbacks());
      }
    },
    onEnd(wasStopped: boolean) {
      if (!wasStopped && stepVoiceState.state.value === 'listening') {
        speechRecognition.start(makeCallbacks());
      }
    },
  };
}

// --- Public API ---

export const stepVoiceService = {
  /** Open overlay and start listening immediately */
  start() {
    if (stepVoiceState.isActive.value) return;
    stepVoiceState.isActive.value = true;
    accumulatedText = '';
    stepVoiceState.transcript.value = '';
    stepVoiceState.responseText.value = '';
    stepVoiceState.state.value = 'listening';
    speechRecognition.start(makeCallbacks());
  },

  /** Close overlay and stop everything */
  stop() {
    cleanupStreamWatches();
    if (autoSendTimer) clearTimeout(autoSendTimer);
    speechRecognition.stop();
    window.speechSynthesis.cancel();
    stepVoiceState.isActive.value = false;
    stepVoiceState.state.value = 'idle';
    stepVoiceState.transcript.value = '';
    stepVoiceState.responseText.value = '';
    accumulatedText = '';
    ttsQueue = [];
    isSpeaking = false;
    pendingBuffer = '';
  },

  /** Start listening (idle → listening) */
  startListening() {
    accumulatedText = '';
    stepVoiceState.transcript.value = '';
    stepVoiceState.state.value = 'listening';
    speechRecognition.start(makeCallbacks());
  },

  /** Stop mic, send text, stream TTS sentence by sentence */
  async send() {
    if (autoSendTimer) clearTimeout(autoSendTimer);
    startStreamingTTS(accumulatedText.trim());
  },

  /** Stop TTS and clear queue */
  stopSpeaking() {
    window.speechSynthesis.cancel();
    ttsQueue = [];
    isSpeaking = false;
  },
};
