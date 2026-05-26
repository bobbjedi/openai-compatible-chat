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
import { useSettingsStore } from 'src/stores/settingsStore';
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
// eslint-disable-next-line prefer-const
let lastResultTime = 0;

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
  const now = Date.now();
  const elapsed = now - lastResultTime;
  // eslint-disable-next-line no-console
  console.log('[VoiceMode] onSilenceTimeout fired, ts=', now, 'silenceDelay=', voiceState.silenceDelay.value, 'elapsed=', elapsed, 'ms, lastResultTs=', lastResultTime, 'accumulatedText="', accumulatedText, '" isProcessing=', isProcessing);
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

  // eslint-disable-next-line no-console
  console.log('[VoiceMode] sending message, mic should be off');

  chatStore.sendMessage(msgText).then(() => {
    voiceState.state.value = 'speaking';
  }).catch(() => {
    if (voiceState.isActive.value) {
      voiceState.state.value = 'listening';
    }
  }).finally(() => {
    isProcessing = false;
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
      // Build new accumulated text
      const newText = accumulatedText
        ? `${accumulatedText} ${text}`
        : text;
      // Only reset timer if text actually grew (new content from API)
      if (newText !== accumulatedText) {
        accumulatedText = newText;
        voiceState.transcript.value = accumulatedText;
        lastResultTime = Date.now();

        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(onSilenceTimeout, voiceState.silenceDelay.value);
        // eslint-disable-next-line no-console
        console.log('[VoiceMode] onResult — new content, timer reset, ts=', lastResultTime, 'silenceDelay=', voiceState.silenceDelay.value, 'accumulatedText="', accumulatedText, '"');
      } else {
        // eslint-disable-next-line no-console
        console.log('[VoiceMode] onResult — duplicate, no reset, ts=', Date.now(), 'text="', text, '"');
      }
    },
    onInterim(text: string) {
      if (!isProcessing) {
        voiceState.transcript.value = accumulatedText
          ? `${accumulatedText} ${text}`
          : text;
        // Reset silence timer on interim results too — user is still speaking
        lastResultTime = Date.now();
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(onSilenceTimeout, voiceState.silenceDelay.value);
        // eslint-disable-next-line no-console
        console.log('[VoiceMode] onInterim — timer reset, ts=', lastResultTime, 'interim="', text, '"');
      }
    },
    onError() {
      stopVoiceMode();
    },
    onEnd() {
      // continuous: true — onEnd fires only on explicit stop() or error
      // Voice Mode controls lifecycle via start()/stop()/resumeListening()
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

    // Apply settings from store on start
    const settings = useSettingsStore();
    voiceState.silenceDelay.value = settings.voiceSilenceDelay;
    voiceState.ttsRate.value = settings.ttsRate;

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

    // Stop microphone before speaking
    speechRecognition.stop();
    voiceState.state.value = 'speaking';
    await speakText(text);

    if (voiceState.isActive.value) {
      accumulatedText = '';
      voiceState.state.value = 'listening';
      // Wait for sound to fade before re-enabling mic
      await new Promise((r) => { setTimeout(r, 500); });
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
