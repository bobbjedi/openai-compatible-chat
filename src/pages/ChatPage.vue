<template>
    <q-page class="chatgpt-page">
        <!-- Header -->
        <q-bar class="chatgpt-bar">
            <div class="text-subtitle2 ellipsis">
                {{ store.currentSession?.title || 'ChatGPT' }}
            </div>
            <q-space />
            <q-btn v-if="store.currentSession?.summary" flat dense size="sm" icon="description" color="grey-6"
                @click="summaryDialog = true">
                <q-tooltip>View Summary</q-tooltip>
            </q-btn>
        </q-bar>

        <!-- Error -->
        <q-banner v-if="store.error" dense class="bg-negative text-white">
            {{ store.error }}
            <template #action>
                <q-btn flat dense round icon="close" @click="store.error = null" />
            </template>
        </q-banner>

        <!-- Facts notification -->
        <div v-if="store.factsNotification
            && store.factsNotification.length > 0" class="chatgpt-facts-banner">
            <div class="chatgpt-facts-banner-header">
                <q-icon name="fact_check" color="accent" size="sm" />
                <span class="text-weight-medium">
                    🧠 {{ store.factsNotification.length }} new fact(s) extracted
                </span>
                <q-space />
                <q-btn v-if="!showFullFacts && !editingFactsInline" flat dense no-caps size="sm" color="accent"
                    label="Show" @click="showFullFacts = true" />
                <q-btn v-else-if="!editingFactsInline" flat dense no-caps size="sm" color="accent" label="Hide"
                    @click="showFullFacts = false" />
                <q-btn v-if="editingFactsInline" flat dense no-caps size="sm" color="primary" label="Save"
                    @click="saveFactsInline" />
                <q-btn v-if="!editingFactsInline" flat dense round size="sm" icon="close" color="grey-6"
                    @click="store.factsNotification = null">
                    <q-tooltip>Dismiss</q-tooltip>
                </q-btn>
            </div>
            <div v-if="showFullFacts && !editingFactsInline" class="chatgpt-facts-banner-body">
                <ul class="chatgpt-facts-list-small">
                    <li v-for="(fact, i) in store.factsNotification" :key="i">{{ fact }}</li>
                </ul>
            </div>
            <div v-if="editingFactsInline" class="chatgpt-facts-banner-body">
                <div class="text-caption text-grey-6 q-mb-sm">
                    One fact per line. Ctrl+Enter to save.
                </div>
                <q-input v-model="factsEditText" outlined dense autogrow type="textarea"
                    class="chatgpt-facts-edit-input" @keydown.ctrl.enter="saveFactsInline" />
            </div>
        </div>

        <!-- Messages -->
        <div ref="scrollRef" class="chatgpt-messages">
            <div v-if="store.displayMessages.length === 0
                && !store.isStreaming" class="chatgpt-welcome">
                <div class="chatgpt-welcome-logo">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                        <rect width="48" height="48" rx="12" fill="#10a37f" />
                        <path d="M24 14L26.472 21.528H34L27.764 26.472
              L30.236 34L24 29.056L17.764 34L20.236
              26.472L14 21.528H21.528L24 14Z" fill="white" />
                    </svg>
                </div>
                <h1 class="chatgpt-welcome-title">How can I help you?</h1>
            </div>

            <!-- Message list -->
            <div v-for="msg in store.displayMessages" :key="msg.id" class="chatgpt-msg-row" :class="msg.role === 'assistant'
                ? 'chatgpt-msg--assistant'
                : 'chatgpt-msg--user'">
                <div class="chatgpt-msg-inner">
                    <div class="chatgpt-avatar">
                        <div v-if="msg.role === 'assistant'" class="chatgpt-avatar-assistant">
                            <svg width="20" height="20" viewBox="0 0 48 48">
                                <rect width="48" height="48" rx="12" fill="#10a37f" />
                                <path d="M24 14L26.472 21.528H34L27.764
                  26.472L30.236 34L24 29.056L17.764 34
                  L20.236 26.472L14 21.528H21.528L24 14Z" fill="white" />
                            </svg>
                        </div>
                        <q-avatar v-else color="primary" size="32px" text-color="white" class="chatgpt-avatar-user">
                            <svg width="20" height="20" viewBox="0 0 24 24">
                                <path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4
                  1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8
                  1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                            </svg>
                        </q-avatar>
                    </div>
                    <div class="chatgpt-msg-content">
                        <div class="chatgpt-msg-author">
                            {{ msg.role === 'assistant' ? 'LLM' : 'You' }}
                        </div>
                        <!-- Edit mode for user messages -->
                        <div v-if="editingId === msg.id" class="chatgpt-edit-area">
                            <q-input v-model="editText" outlined dense autogrow type="textarea"
                                class="chatgpt-edit-input" @keydown.ctrl.enter="saveEdit(msg.id ?? 0)" />
                            <div class="chatgpt-edit-actions">
                                <q-btn flat size="sm" label="Cancel" @click="cancelEdit" />
                                <q-btn flat size="sm" color="primary" label="Save & Submit" :disable="!editText.trim()"
                                    @click="saveEdit(msg.id ?? 0)" />
                            </div>
                            <div class="chatgpt-edit-hint
                  text-caption text-grey-6">
                                Ctrl+Enter to submit
                            </div>
                        </div>
                        <div v-else>
                            <div v-if="msg.role === 'assistant'" class="chatgpt-markdown"
                                v-html="renderMarkdown(msg.content || '_..._')" />
                            <div v-else class="chatgpt-text">
                                {{ msg.content }}
                            </div>
                        </div>
                        <!-- Action buttons (Copy + Edit) -->
                        <div v-if="editingId !== msg.id
                            && !store.isStreaming" class="chatgpt-msg-actions">
                            <q-btn flat dense size="sm" icon="content_copy" color="grey-6"
                                @click="copyMessage(msg.content)">
                                <q-tooltip>Copy</q-tooltip>
                            </q-btn>
                            <q-btn v-if="msg.role === 'user'" flat dense size="sm" icon="edit" color="grey-6"
                                @click="startEdit(msg)">
                                <q-tooltip>Edit</q-tooltip>
                            </q-btn>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Streaming indicator -->
            <div v-if="store.isStreaming && !lastAssistantContent" class="chatgpt-msg-row chatgpt-msg--assistant">
                <div class="chatgpt-msg-inner">
                    <div class="chatgpt-avatar">
                        <div class="chatgpt-avatar-assistant">
                            <svg width="20" height="20" viewBox="0 0 48 48">
                                <rect width="48" height="48" rx="12" fill="#10a37f" />
                                <path d="M24 14L26.472 21.528H34L27.764
                  26.472L30.236 34L24 29.056L17.764 34
                  L20.236 26.472L14 21.528H21.528L24 14Z" fill="white" />
                            </svg>
                        </div>
                    </div>
                    <div class="chatgpt-msg-content">
                        <q-spinner-dots size="1rem" color="grey-6" />
                    </div>
                </div>
            </div>
        </div>

        <!-- Input -->
        <ChatInput />

        <!-- Summary dialog -->
        <q-dialog v-model="summaryDialog" maximized>
            <q-card class="chatgpt-summary-dialog">
                <q-bar class="bg-white text-black">
                    <div class="text-subtitle2 ellipsis">
                        Summary — {{ store.currentSession?.title || 'Chat' }}
                    </div>
                    <q-space />
                    <q-btn dense flat icon="close" v-close-popup>
                        <q-tooltip>Close</q-tooltip>
                    </q-btn>
                </q-bar>
                <q-card-section class="chatgpt-summary-content">
                    <div class="chatgpt-summary-text">{{ store.currentSession?.summary || '' }}</div>
                </q-card-section>
            </q-card>
        </q-dialog>
    </q-page>
</template>

<script lang="ts">
import {
    defineComponent, ref, watch, computed,
    nextTick, onMounted,
} from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useChatStore, type Message } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import ChatInput from 'src/components/ChatInput.vue';

export default defineComponent({
    name: 'ChatPage',
    components: { ChatInput },
    setup() {
        const store = useChatStore();
        const scrollRef = ref<HTMLElement | null>(null);
        const editingId = ref<number | null>(null);
        const editText = ref('');
        const summaryDialog = ref(false);
        const showFullFacts = ref(false);
        const editingFactsInline = ref(false);
        const factsEditText = ref('');

        const settingsStore = useSettingsStore();

        onMounted(async () => {
            await store.init();
        });

        function renderMarkdown(text: string): string {
            const raw = marked.parse(text, { async: false }) as string;
            return DOMPurify.sanitize(raw);
        }

        function scrollToBottom() {
            const el = scrollRef.value;
            if (el) el.scrollTop = el.scrollHeight;
        }

        watch(
            () => store.displayMessages.length,
            () => {
                void nextTick().then(scrollToBottom);
            },
        );

        watch(
            () => {
                const msgs = store.displayMessages;
                return msgs.length > 0 ? msgs[msgs.length - 1].content : '';
            },
            () => {
                void nextTick().then(() => {
                    const el = scrollRef.value;
                    if (el) {
                        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                        if (dist < 100 || store.isStreaming) {
                            el.scrollTop = el.scrollHeight;
                        }
                    }
                });
            },
        );

        const lastAssistantContent = computed(() => {
            const msgs = store.messages;
            for (let i = msgs.length - 1; i >= 0; i -= 1) {
                if (msgs[i].role === 'assistant') return !!msgs[i].content;
            }
            return false;
        });

        function startEdit(msg: Message) {
            editingId.value = msg.id ?? null;
            editText.value = msg.content;
        }

        function startEditFactsInline() {
            factsEditText.value = (store.factsNotification || []).join('\n');
            editingFactsInline.value = true;
            showFullFacts.value = true;
        }

        async function saveFactsInline() {
            if (factsEditText.value.trim()) {
                const lines = factsEditText.value
                    .split('\n')
                    .map((l: string) => l.trim())
                    .filter((l: string) => l.length > 0);
                await settingsStore.saveUserFacts(lines);
                store.factsNotification = null;
            }
            editingFactsInline.value = false;
        }

        function copyMessage(text: string) {
            void navigator.clipboard.writeText(text);
        }

        function cancelEdit() {
            editingId.value = null;
            editText.value = '';
        }

        async function saveEdit(messageId: number) {
            const text = editText.value.trim();
            if (!text) return;
            editingId.value = null;
            editText.value = '';
            await store.editMessage(messageId, text);
            void nextTick().then(scrollToBottom);
        }

        return {
            store,
            scrollRef,
            renderMarkdown,
            editingId,
            editText,
            copyMessage,
            lastAssistantContent,
            startEdit,
            cancelEdit,
            saveEdit,
            summaryDialog,
            showFullFacts,
            editingFactsInline,
            factsEditText,
            startEditFactsInline,
            saveFactsInline,
        };
    },
});
</script>
