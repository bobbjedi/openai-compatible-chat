<template>
    <q-page class="chatgpt-page">
        <!-- Header -->
        <q-bar class="chatgpt-bar">
            <div class="text-subtitle2 ellipsis">
                {{ store.currentSession?.title || 'ChatGPT' }}
            </div>
        </q-bar>

        <!-- Error -->
        <q-banner v-if="store.error" dense class="bg-negative text-white">
            {{ store.error }}
            <template #action>
                <q-btn flat dense round icon="close" @click="store.error = null" />
            </template>
        </q-banner>

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
            <div v-for="(msg, i) in store.displayMessages" :key="msg.id" class="chatgpt-msg-row" :class="msg.role === 'assistant'
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
                            {{ msg.role === 'assistant' ? 'ChatGPT' : 'You' }}
                        </div>
                        <!-- Edit mode for user messages -->
                        <div v-if="editingId === msg.id" class="chatgpt-edit-area">
                            <q-input v-model="editText" outlined dense autogrow type="textarea"
                                class="chatgpt-edit-input" @keydown.ctrl.enter="saveEdit(msg.id!)" />
                            <div class="chatgpt-edit-actions">
                                <q-btn flat size="sm" label="Cancel" @click="cancelEdit" />
                                <q-btn flat size="sm" color="primary" label="Save & Submit" :disable="!editText.trim()"
                                    @click="saveEdit(msg.id!)" />
                            </div>
                            <div class="chatgpt-edit-hint text-caption text-grey-6">
                                Ctrl+Enter to submit
                            </div>
                        </div>
                        <div v-else>
                            <div v-if="msg.role === 'assistant'" class="chatgpt-markdown" v-html="renderMarkdown(
                                msg.content || '_..._')" />
                            <div v-else class="chatgpt-text">
                                {{ msg.content }}
                            </div>
                        </div>
                        <!-- Edit button for user messages (not in edit mode, not streaming) -->
                        <div v-if="msg.role === 'user' && editingId !== msg.id && !store.isStreaming
                            && i === store.displayMessages.length - 1" class="chatgpt-edit-btn-row">
                            <q-btn flat dense size="sm" icon="edit" color="grey-6" @click="startEdit(msg)">
                                <q-tooltip>Edit</q-tooltip>
                            </q-btn>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Streaming indicator -->
            <div v-if="store.isStreaming" class="chatgpt-msg-row chatgpt-msg--assistant">
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
    </q-page>
</template>

<script lang="ts">
import {
    defineComponent, ref, watch,
    nextTick, onMounted,
} from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useChatStore, type Message } from 'src/stores/chatStore';
import ChatInput from 'src/components/ChatInput.vue';

export default defineComponent({
    name: 'ChatPage',
    components: { ChatInput },
    setup() {
        const store = useChatStore();
        const scrollRef = ref<HTMLElement | null>(null);
        const editingId = ref<number | null>(null);
        const editText = ref('');

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
            () => nextTick().then(scrollToBottom),
        );

        watch(
            () => {
                const msgs = store.displayMessages;
                return msgs.length > 0 ? msgs[msgs.length - 1].content : '';
            },
            () => {
                nextTick().then(() => {
                    const el = scrollRef.value;
                    if (el) {
                        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                        if (nearBottom || store.isStreaming) el.scrollTop = el.scrollHeight;
                    }
                });
            },
        );

        function startEdit(msg: Message) {
            editingId.value = msg.id!;
            editText.value = msg.content;
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
            nextTick().then(scrollToBottom);
        }

        return {
            store,
            scrollRef,
            renderMarkdown,
            editingId,
            editText,
            startEdit,
            cancelEdit,
            saveEdit,
        };
    },
});
</script>
