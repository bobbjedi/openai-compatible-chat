<template>
    <div class="chatgpt-input-wrapper">
        <div class="chatgpt-input-inner">
            <q-input v-model="text" outlined dense autogrow placeholder="Message ChatGPT..."
                :disable="store.isStreaming" class="chatgpt-input" @keydown.enter.exact="onEnterKey">
                <template #append>
                    <q-btn v-if="recognitionSupported" flat dense round size="sm"
                        :icon="isListening ? 'mic' : 'mic_none'" :color="isListening ? 'red' : 'black'"
                        :class="{ 'chatgpt-mic-btn--listening': isListening }" :disable="store.isStreaming"
                        @click="toggleListening">
                        <q-tooltip>{{ isListening ? 'Stop listening' : 'Voice input' }}</q-tooltip>
                    </q-btn>
                    <q-btn v-if="store.isStreaming" flat dense round size="sm" icon="stop" color="black"
                        @click="store.cancelStream()">
                        <q-tooltip>Stop</q-tooltip>
                    </q-btn>
                    <q-btn v-else flat dense round size="sm" icon="arrow_upward" color="black" :disable="!text.trim()"
                        class="chatgpt-send-btn" @click="submit" />
                </template>
            </q-input>
            <p class="chatgpt-disclaimer text-caption text-grey-6">
                ChatGPT can make mistakes. Check important info.
            </p>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useChatStore } from 'src/stores/chatStore';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
let SpeechRecognitionAPI: any = null;
if (typeof window !== 'undefined') {
    SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

export default defineComponent({
    name: 'ChatInput',
    setup() {
        const store = useChatStore();
        const text = ref('');
        const isListening = ref(false);
        const recognitionSupported = ref(!!SpeechRecognitionAPI);

        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
        let recognition: any = null;

        function initRecognition() {
            if (!SpeechRecognitionAPI) return;
            recognition = new SpeechRecognitionAPI();
            recognition.continuous = true;
            recognition.interimResults = true;
            // Try navigator.languages (ordered preferences), then Intl (OS locale), then navigator.language
            const langs = navigator.languages?.length
                ? navigator.languages
                : [Intl.DateTimeFormat().resolvedOptions().locale, navigator.language];
            const isRu = langs.some((l) => l.toLowerCase().startsWith('ru'));
            recognition.lang = isRu ? 'ru-RU' : 'en-US';

            recognition.onresult = (event: any) => {
                let result = '';
                // Iterate only NEW results (from resultIndex), not all
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    result += event.results[i][0].transcript;
                }
                // Append only FINAL fragments with spaces around them
                if (event.results[event.resultIndex]?.isFinal) {
                    text.value += ` ${result} `;
                }
            };

            recognition.onerror = (event: any) => {
                console.error('[Voice] Recognition error:', event.error);
                isListening.value = false;
            };

            recognition.onend = () => {
                isListening.value = false;
            };
        }

        function toggleListening() {
            if (!SpeechRecognitionAPI || store.isStreaming) return;
            if (isListening.value) {
                recognition?.stop();
            } else {
                initRecognition();
                isListening.value = true;
                recognition?.start();
            }
        }

        function submit() {
            const val = text.value.trim();
            if (!val || store.isStreaming) return;
            if (isListening.value) {
                recognition?.stop();
            }
            text.value = '';
            void store.sendMessage(val);
        }

        const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);

        function onEnterKey(e: KeyboardEvent) {
            if (isMobile) {
                // Mobile: Enter → newline (default), send only via button
                return;
            }
            // Desktop: Enter → send, Shift+Enter → newline
            if (e.shiftKey) return; // newline
            e.preventDefault();
            submit();
        }
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

        return {
            text, store, onEnterKey, submit, isListening, recognitionSupported, toggleListening,
        };
    },
});
</script>
