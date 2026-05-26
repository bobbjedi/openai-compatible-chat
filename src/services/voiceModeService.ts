/**
 * Voice Mode Service — real-time голосовой чат.
 *
 * Цикл:
 * 1. SpeechRecognition слушает
 * 2. Тишина > silenceDelay → beep → отправка в LLM
 * 3. LLM отвечает → TTS озвучивает
 * 4. TTS закончил → снова слушаем
 * 5. Stop → всё останавливается
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable no-use-before-define */

import { ref, type Ref } from 'vue';
import { useChatStore } from 'src/stores/chatStore';

// --- Состояние ---

export type VoiceModeState = 'idle' | 'listening' | 'thinking' | 'speaking';

export const voiceState = {
  isActive: ref(false) as Ref<boolean>,
  state: ref<VoiceModeState>('idle') as Ref<VoiceModeState>,
  transcript: ref('') as Ref<string>,
  reasoning: ref('') as Ref<string>,
  silenceDelay: ref(1500) as Ref<number>,
  ttsRate: ref(1.0) as Ref<number>,
};

// --- Внутренние переменные ---

let recognition: any = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let isListening = false;
let accumulatedText = '';

// --- Beep generator ---

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // AudioContext not available
  }
}

// --- Вспомогательные функции (объявлены до startListening) ---

function stopVoiceMode() {
  voiceState.isActive.value = false;
  voiceState.state.value = 'idle';
  voiceState.transcript.value = '';

  window.speechSynthesis.cancel();

  if (recognition && isListening) {
    try { recognition.stop(); } catch { /* ignore */ }
    isListening = false;
  }

  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  accumulatedText = '';
}

function onSilenceTimeout() {
  const text = accumulatedText.trim();
  if (!text) return;

  // Stop listening and prevent re-start via onend
  if (recognition && isListening) {
    try { recognition.stop(); } catch { /* ignore */ }
    isListening = false;
  }
  // Remove onend handler to prevent auto-restart
  if (recognition) {
    recognition.onend = null;
  }

  voiceState.state.value = 'thinking';
  voiceState.transcript.value = '';
  voiceState.reasoning.value = '';

  playBeep();

  const chatStore = useChatStore();
  const msgText = text;
  accumulatedText = '';

  chatStore.sendMessage(msgText).then(() => {
    voiceState.state.value = 'speaking';
  }).catch(() => {
    if (voiceState.isActive.value) {
      voiceState.state.value = 'listening';
    }
  });
}

// --- Speech Recognition ---

function startListening() {
  const SpeechRecognitionAPI = (window as any).SpeechRecognition
    || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) return;

  if (recognition && isListening) return;

  // If TTS is speaking, stop it — user wants to interrupt
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  if (!recognition) {
    recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;

    const langs = navigator.languages?.length
      ? navigator.languages
      : [Intl.DateTimeFormat().resolvedOptions().locale, navigator.language];
    const isRu = langs.some((l: string) => l.toLowerCase().startsWith('ru'));
    recognition.lang = isRu ? 'ru-RU' : 'en-US';

    recognition.onresult = function onResult(event: any) {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          accumulatedText += event.results[i][0].transcript;
        }
      }

      let fullText = accumulatedText;
      const lastResult = event.results[event.results.length - 1];
      if (!lastResult.isFinal) {
        fullText += lastResult[0].transcript;
      }
      voiceState.transcript.value = fullText;

      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(onSilenceTimeout, voiceState.silenceDelay.value);
    };

    recognition.onerror = function onError() {
      stopVoiceMode();
    };

    recognition.onend = function onEnd() {
      isListening = false;
      if (voiceState.isActive.value) {
        startListening();
      }
    };
  }

  try {
    recognition.start();
    isListening = true;
    voiceState.state.value = 'listening';
  } catch {
    // Already started
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

    if (!cleanText) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ru-RU';
    utterance.rate = voiceState.ttsRate.value;
    utterance.pitch = 1.0;

    utterance.onend = () => { resolve(); };
    utterance.onerror = () => { resolve(); };

    window.speechSynthesis.speak(utterance);
  });
}

// --- Публичное API ---

export const voiceModeService = {
  start() {
    if (voiceState.isActive.value) return;

    voiceState.isActive.value = true;
    voiceState.state.value = 'listening';
    voiceState.transcript.value = '';
    accumulatedText = '';

    startListening();
  },

  stop() {
    stopVoiceMode();
  },

  async speakResponse(text: string) {
    if (!voiceState.isActive.value) return;

    voiceState.state.value = 'speaking';
    await speakText(text);

    if (voiceState.isActive.value) {
      accumulatedText = '';
      voiceState.state.value = 'listening';
      startListening();
    }
  },

  setSilenceDelay(ms: number) {
    voiceState.silenceDelay.value = Math.max(500, Math.min(5000, ms));
  },

  setReasoning(text: string) {
    voiceState.reasoning.value = text;
  },

  resumeListening() {
    if (!voiceState.isActive.value) return;
    accumulatedText = '';
    voiceState.state.value = 'listening';
    voiceState.reasoning.value = '';
    // Re-create recognition to get fresh onend handler
    if (recognition) {
      try { recognition.stop(); } catch { /* ignore */ }
      recognition = null;
      isListening = false;
    }
    startListening();
  },

  setTtsRate(rate: number) {
    voiceState.ttsRate.value = Math.max(0.3, Math.min(2.0, rate));
  },
};
