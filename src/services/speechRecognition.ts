/**
 * Единая утилита для SpeechRecognition.
 * Используется в ChatInput.vue (надиктовка) и voiceModeService.ts (Voice Mode).
 *
 * Особенности:
 * - continuous: true на десктопе, false на мобильных (Samsung Chrome дублирует фразы)
 * - На мобильных: авто-рестарт через onEnd для непрерывной работы
 * - На десктопе: без авто-рестарта, управление через voiceModeService
 * - Колбэки: onResult(text), onInterim(text), onEnd(), onError(error)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

export interface SpeechRecognitionCallbacks {
  onResult?: (text: string) => void;
  onInterim?: (text: string) => void;
  onEnd?: (wasStopped: boolean) => void;
  onError?: (error: string) => void;
}

let recognition: any = null;
let isActive = false;
let savedCallbacks: SpeechRecognitionCallbacks | null = null;
// eslint-disable-next-line prefer-const
let wasStopped = false;

const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(
  typeof navigator !== 'undefined' ? navigator.userAgent : '',
);

function getLang(): string {
  const langs = navigator.languages?.length
    ? navigator.languages
    : [Intl.DateTimeFormat().resolvedOptions().locale, navigator.language];
  const isRu = langs.some((l: string) => l.toLowerCase().startsWith('ru'));
  return isRu ? 'ru-RU' : 'en-US';
}

function stopInternal(): void {
  if (recognition && isActive) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
  recognition = null;
  isActive = false;
}

function startInternal(): void {
  const SpeechRecognitionAPI = (window as any).SpeechRecognition
    || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) return;

  // Stop previous instance but keep isActive
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
    recognition = null;
  }

  recognition = new SpeechRecognitionAPI();
  // Mobile browsers (Samsung Chrome) duplicate phrases with continuous: true
  recognition.continuous = !isMobile;
  recognition.interimResults = true;
  recognition.lang = getLang();

  const callbacks = savedCallbacks;
  if (!callbacks) return;

  recognition.onresult = (event: any) => {
    const last = event.results[event.results.length - 1];
    if (last.isFinal) {
      const transcript = last[0].transcript.trim();
      if (transcript) {
        callbacks.onResult?.(transcript);
      }
    } else {
      callbacks.onInterim?.(last[0].transcript);
    }
  };

  recognition.onerror = (event: any) => {
    callbacks.onError?.(event.error || 'unknown');
    isActive = false;
  };

  recognition.onend = () => {
    callbacks.onEnd?.(wasStopped);
    isActive = false;
    wasStopped = false;
  };

  try {
    recognition.start();
    isActive = true;
  } catch {
    // Already started
  }
}

export const speechRecognition = {
  start(callbacks: SpeechRecognitionCallbacks): void {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition
      || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      callbacks.onError?.('SpeechRecognition not supported');
      return;
    }
    savedCallbacks = callbacks;
    // eslint-disable-next-line no-console
    console.log('[speechRecognition] start() continuous=', !isMobile);
    startInternal();
  },

  stop(): void {
    // eslint-disable-next-line no-console
    console.log('[speechRecognition] stop()');
    wasStopped = true;
    stopInternal();
    savedCallbacks = null;
  },

  get isActive(): boolean {
    return isActive;
  },
};
