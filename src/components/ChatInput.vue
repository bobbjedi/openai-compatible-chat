<template>
    <div class="chatgpt-input-wrapper">
        <!-- File chips -->
        <div v-if="pendingFiles.length > 0" class="chatgpt-file-chips">
            <q-chip v-for="(f, i) in pendingFiles" :key="i" dense removable color="grey-3" text-color="black"
                class="chatgpt-file-chip" @remove="removeFile(i)">
                <template v-if="isImageFile(f)">
                    <q-icon name="image" size="xs" class="q-mr-xs" />
                    <img :src="pendingPreviews[i]" class="chatgpt-file-preview-thumb" />
                </template>
                <template v-else>
                    <q-icon name="description" size="xs" class="q-mr-xs" />
                </template>
                {{ f.name }}
                <span class="chatgpt-file-size text-caption text-grey-6 q-ml-xs">
                    ({{ formatSize(f.size) }})
                </span>
            </q-chip>
        </div>
        <div class="chatgpt-input-inner">
            <!-- Hidden file input -->
            <input ref="fileInputRef" type="file" multiple class="chatgpt-file-input-hidden"
                @change="onFilesSelected" />
            <q-input v-model="text" outlined dense autogrow placeholder="Message ChatGPT..." class="chatgpt-input"
                @keydown.enter.exact="onEnterKey">
                <template #prepend>
                    <q-btn flat dense round size="sm" icon="attach_file" :disable="store.isStreaming"
                        @click="openFilePicker">
                        <q-tooltip>Attach files</q-tooltip>
                    </q-btn>
                </template>
                <template #append>
                    <q-btn v-if="recognitionSupported" flat dense round size="sm"
                        :icon="isListening ? 'mic' : 'mic_none'" :color="isListening ? 'red' : 'black'"
                        :class="{ 'chatgpt-mic-btn--listening': isListening }" :disable="store.isStreaming"
                        @click="toggleListening">
                        <q-tooltip>{{ isListening ? 'Stop listening' : 'Voice input' }}</q-tooltip>
                    </q-btn>
                    <q-btn v-if="store.isStreaming || store.isSearching" flat dense round size="sm" icon="stop"
                        color="black" @click="store.cancelStream()">
                        <q-tooltip>Stop</q-tooltip>
                    </q-btn>
                    <q-btn v-else flat dense round size="sm" icon="arrow_upward" color="black"
                        :disable="!text.trim() && pendingFiles.length === 0" class="chatgpt-send-btn" @click="submit" />
                </template>
            </q-input>
            <p class="chatgpt-disclaimer text-caption text-grey-6">
                LLMChat can make mistakes. Check important info.
            </p>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useChatStore } from 'src/stores/chatStore';
import { parseFiles, type ParseResult } from 'src/services/fileParser';

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
        const pendingFiles = ref<File[]>([]);
        const fileInputRef = ref<HTMLInputElement | null>(null);
        const isListening = ref(false);
        const recognitionSupported = ref(!!SpeechRecognitionAPI);

        const pendingPreviews = ref<string[]>([]);

        function isImageFile(f: File): boolean {
            return f.type.startsWith('image/');
        }

        function formatSize(bytes: number): string {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }

        function openFilePicker() {
            fileInputRef.value?.click();
        }

        function onFilesSelected(e: Event) {
            const input = e.target as HTMLInputElement;
            if (input.files) {
                const newFiles = Array.from(input.files);
                newFiles.forEach((f) => {
                    if (isImageFile(f)) {
                        pendingPreviews.value.push(URL.createObjectURL(f));
                    } else {
                        pendingPreviews.value.push('');
                    }
                });
                pendingFiles.value.push(...newFiles);
            }
            input.value = '';
        }

        function removeFile(index: number) {
            if (pendingPreviews.value[index]) {
                URL.revokeObjectURL(pendingPreviews.value[index]);
            }
            pendingPreviews.value.splice(index, 1);
            pendingFiles.value.splice(index, 1);
        }

        /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
        let recognition: any = null;

        function initRecognition() {
            if (!SpeechRecognitionAPI) return;
            recognition = new SpeechRecognitionAPI();
            recognition.continuous = true;
            recognition.interimResults = true;
            const langs = navigator.languages?.length
                ? navigator.languages
                : [Intl.DateTimeFormat().resolvedOptions().locale, navigator.language];
            const isRu = langs.some((l) => l.toLowerCase().startsWith('ru'));
            recognition.lang = isRu ? 'ru-RU' : 'en-US';

            recognition.onresult = (event: any) => {
                let result = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    result += event.results[i][0].transcript;
                }
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

        async function submit() {
            const val = text.value.trim();
            const hasFiles = pendingFiles.value.length > 0;
            // eslint-disable-next-line no-console
            console.log('[ChatInput] submit: text="', val, '" hasFiles=', hasFiles, 'files=', pendingFiles.value.map((f) => f.name));
            if ((!val && !hasFiles) || store.isStreaming) return;
            if (isListening.value) {
                recognition?.stop();
            }

            let parsed: ParseResult[] | undefined;
            if (hasFiles) {
                parsed = await parseFiles(pendingFiles.value);
                // eslint-disable-next-line no-console
                console.log('[ChatInput] parsed:', parsed.map((p) => ({ name: p.name, len: p.text.length })));
                pendingFiles.value = [];
            }

            text.value = '';
            void store.sendMessage(val || '(attached files)', parsed);
        }

        const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);

        function onEnterKey(e: KeyboardEvent) {
            if (isMobile) {
                return;
            }
            if (e.shiftKey) return;
            e.preventDefault();
            void submit();
        }
        /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */

        return {
            text,
            store,
            onEnterKey,
            submit,
            isListening,
            recognitionSupported,
            toggleListening,
            pendingFiles,
            pendingPreviews,
            fileInputRef,
            openFilePicker,
            onFilesSelected,
            removeFile,
            formatSize,
            isImageFile,
        };
    },
});
</script>
