/**
 * Step-by-Step Voice Mode — semi-automatic voice mode.
 *
 * State cycle:
 *   idle → listening → thinking → speaking → listening → ...
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

import { ref } from 'vue';
import { useChatStore } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { speechRecognition } from './speechRecognition';

export type StepVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export const stepVoiceState = {
  isActive: ref(false),
  state: ref<StepVoiceState>('idle'),
  transcript: ref(''),
  responseText: ref(''),
};

let accumulatedText = '';
// eslint-disable-next-line prefer-const
let autoSendTimer: ReturnType<typeof setTimeout> | null = null;

// --- Beep generator ---

function playBeep(freq = 880, duration = 0.15) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // AudioContext not available
  }
}

// --- TTS ---

function speakText(text: string): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const cleanText = text
      .replace(/[#*_`[\]()>|~]/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();
    if (!cleanText) { resolve(); return; }
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

// --- Speech Recognition callbacks (declared before doSend) ---

function makeCallbacks() {
  return {
    onResult(text: string) {
      accumulatedText = accumulatedText ? `${accumulatedText} ${text}` : text;
      stepVoiceState.transcript.value = accumulatedText;
      // Reset auto-send timer
      if (autoSendTimer) clearTimeout(autoSendTimer);
      const settings = useSettingsStore();
      const timeout = settings.stepVoiceTimeout;
      if (timeout > 0) {
        autoSendTimer = setTimeout(() => {
          if (stepVoiceState.state.value === 'listening' && accumulatedText.trim()) {
            // eslint-disable-next-line no-use-before-define
            doSend(accumulatedText.trim());
          }
        }, timeout);
      }
    },
    onInterim(text: string) {
      stepVoiceState.transcript.value = accumulatedText ? `${accumulatedText} ${text}` : text;
      // Reset auto-send timer
      if (autoSendTimer) clearTimeout(autoSendTimer);
      const settings = useSettingsStore();
      const timeout = settings.stepVoiceTimeout;
      if (timeout > 0) {
        autoSendTimer = setTimeout(() => {
          if (stepVoiceState.state.value === 'listening' && accumulatedText.trim()) {
            // eslint-disable-next-line no-use-before-define
            doSend(accumulatedText.trim());
          }
        }, timeout);
      }
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

// --- Send logic ---

async function doSend(text: string) {
  if (!text) return;
  speechRecognition.stop();
  // Low beep — "processing"
  playBeep(440, 0.3);
  stepVoiceState.state.value = 'thinking';
  accumulatedText = '';

  const chatStore = useChatStore();
  const settings = useSettingsStore();
  await settings.load();
  if (!settings.apiKey) { stepVoiceState.state.value = 'idle'; return; }
  if (!chatStore.currentSessionId) {
    await chatStore.createSession(text.slice(0, 50));
  }

  await chatStore.sendMessage(`[Voice] ${text}`);

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

  // After TTS — go back to listening
  accumulatedText = '';
  stepVoiceState.transcript.value = '';
  stepVoiceState.state.value = 'listening';
  // High beep — "you can speak now"
  playBeep(1100, 0.3);
  speechRecognition.start(makeCallbacks());
}

// --- Public API ---

export const stepVoiceService = {
  start() {
    if (stepVoiceState.isActive.value) return;
    stepVoiceState.isActive.value = true;
    accumulatedText = '';
    stepVoiceState.transcript.value = '';
    stepVoiceState.responseText.value = '';
    stepVoiceState.state.value = 'listening';
    speechRecognition.start(makeCallbacks());
  },

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

  startListening() {
    accumulatedText = '';
    stepVoiceState.transcript.value = '';
    stepVoiceState.state.value = 'listening';
    // High beep — "you can speak now"
    playBeep(1100, 0.3);
    speechRecognition.start(makeCallbacks());
  },

  async send() {
    if (autoSendTimer) clearTimeout(autoSendTimer);
    await doSend(accumulatedText.trim());
  },

  stopSpeaking() {
    window.speechSynthesis.cancel();
  },
};
