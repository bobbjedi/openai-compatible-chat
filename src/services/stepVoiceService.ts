/**
 * Step-by-Step Voice Mode — semi-automatic voice mode.
 *
 * State cycle:
 *   idle → listening → thinking → speaking → idle → ...
 *
 * Microphone listens continuously until user taps send.
 * After send — message goes to LLM, full response is spoken via TTS.
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

import { ref } from 'vue';
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

// --- TTS ---

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

// --- Send (waits for full response, then speaks it) ---

async function doSend(text: string) {
  if (!text) return;

  speechRecognition.stop();
  stepVoiceState.state.value = 'thinking';
  accumulatedText = '';

  const chatStore = useChatStore();
  const settings = useSettingsStore();
  await settings.load();

  if (!settings.apiKey) {
    stepVoiceState.state.value = 'idle';
    return;
  }

  if (!chatStore.currentSessionId) {
    await chatStore.createSession(text.slice(0, 50));
  }

  // Wait for full response
  await chatStore.sendMessage(text);

  // Find last assistant response
  const msgs = chatStore.messages;
  let lastContent = '';
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'assistant' && msgs[i].content) {
      lastContent = msgs[i].content;
      break;
    }
  }

  if (lastContent) {
    stepVoiceState.responseText.value = lastContent;
    stepVoiceState.state.value = 'speaking';
    await speakText(lastContent);
  }

  stepVoiceState.state.value = 'idle';
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
        doSend(accumulatedText.trim());
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
    if (autoSendTimer) clearTimeout(autoSendTimer);
    speechRecognition.stop();
    window.speechSynthesis.cancel();
    stepVoiceState.isActive.value = false;
    stepVoiceState.state.value = 'idle';
    stepVoiceState.transcript.value = '';
    stepVoiceState.responseText.value = '';
    accumulatedText = '';
  },

  /** Start listening (idle → listening) */
  startListening() {
    accumulatedText = '';
    stepVoiceState.transcript.value = '';
    stepVoiceState.state.value = 'listening';
    speechRecognition.start(makeCallbacks());
  },

  /** Stop mic, send text, wait for full response, speak it */
  async send() {
    if (autoSendTimer) clearTimeout(autoSendTimer);
    await doSend(accumulatedText.trim());
  },

  /** Stop TTS */
  stopSpeaking() {
    window.speechSynthesis.cancel();
  },
};
