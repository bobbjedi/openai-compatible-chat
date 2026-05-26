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
import { speechRecognition } from './speechRecognition';

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

let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let isProcessing = false;
let accumulatedText = '';

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
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
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
  speechRecognition.stop();

  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  accumulatedText = '';
}

function onSilenceTimeout() {
  // Aggressive dedup: remove any word that appears more than once consecutively
  const rawText = accumulatedText.trim();
  if (!rawText || isProcessing) return;

  const words = rawText.split(/\s+/);
  const result: string[] = [];
  let skipCount = 0;
  words.forEach((w, idx) => {
    if (skipCount > 0) {
      skipCount -= 1;
      return;
    }
    // Count consecutive occurrences of this word
    let count = 1;
    for (let j = idx + 1; j < words.length; j += 1) {
      if (words[j].toLowerCase() === w.toLowerCase()) {
        count += 1;
      } else {
        break;
      }
    }
    // If word appears 3+ times consecutively, add only once
    if (count >= 3) {
      result.push(w);
      skipCount = count - 1;
    } else {
      result.push(w);
    }
  });
  const text = result.join(' ');

  if (!text) return;

  isProcessing = true;
  speechRecognition.stop();

  voiceState.state.value = 'thinking';
  voiceState.transcript.value = '';
  voiceState.reasoning.value = '';

  playBeep(440, 0.2);

  const chatStore = useChatStore();
  const msgText = text;
  accumulatedText = '';

  chatStore.sendMessage(msgText).then(() => {
    voiceState.state.value = 'speaking';
    isProcessing = false;
  }).catch(() => {
    isProcessing = false;
    if (voiceState.isActive.value) {
      voiceState.state.value = 'listening';
    }
  });
}

// --- Speech Recognition ---

function startListening() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }

  speechRecognition.start({
    onResult(text: string) {
      if (isProcessing) return;
      accumulatedText = text;
      voiceState.transcript.value = text;

      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(onSilenceTimeout, voiceState.silenceDelay.value);
    },
    onInterim(text: string) {
      if (!isProcessing) {
        voiceState.transcript.value = text;
      }
    },
    onError() {
      stopVoiceMode();
    },
    onEnd() {
      if (voiceState.isActive.value && !isProcessing) {
        setTimeout(startListening, 300);
      }
    },
  });

  voiceState.state.value = 'listening';
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
    speechRecognition.stop();
    // High beep — signal "you can speak now"
    playBeep(1100, 0.1);
    startListening();
  },

  setTtsRate(rate: number) {
    voiceState.ttsRate.value = Math.max(0.3, Math.min(2.0, rate));
  },
};
