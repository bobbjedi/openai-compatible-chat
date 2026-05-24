<template>
    <q-page class="chat-page">
        <!-- Header bar -->
        <q-bar class="bg-primary text-white">
            <div class="text-subtitle2 ellipsis">
                {{ store.currentSession?.title || 'DeepSeek Chat' }}
            </div>
            <q-space />
            <q-btn flat dense round icon="settings" @click="showSettings = true">
                <q-tooltip>Настройки</q-tooltip>
            </q-btn>
        </q-bar>

        <!-- Error banner -->
        <q-banner v-if="store.error" dense class="bg-negative text-white">
            {{ store.error }}
            <template #action>
                <q-btn flat dense round icon="close" @click="store.error = null" />
            </template>
        </q-banner>

        <!-- Messages area -->
        <div ref="scrollRef" class="messages-area q-pa-sm">
            <!-- Empty state -->
            <div v-if="store.displayMessages.length === 0 && !store.isStreaming"
                class="empty-state column items-center justify-center">
                <q-icon name="chat" size="4rem" color="grey-5" />
                <p class="text-grey-6 text-body1 q-mt-md">
                    {{ store.sessions.length === 0
                        ? 'Нажмите "+" в сайдбаре чтобы создать новый чат'
                        : 'Введите сообщение чтобы начать' }}
                </p>
            </div>

            <!-- Messages list -->
            <q-chat-message v-for="msg in store.displayMessages" :key="msg.id" :name="msg.role === 'user' ? 'Вы' : 'AI'"
                :sent="msg.role === 'user'" :stamp="formatTime(msg.createdAt)" :text="[]"
                :bg-color="msg.role === 'user' ? 'primary' : 'grey-4'"
                :text-color="msg.role === 'user' ? 'white' : 'black'">
                <div v-if="msg.role === 'assistant'" class="markdown-body"
                    v-html="renderMarkdown(msg.content || '_..._')" />
                <div v-else>{{ msg.content }}</div>
            </q-chat-message>

            <!-- Streaming indicator -->
            <div v-if="store.isStreaming" class="row items-center q-pa-sm text-grey-6">
                <q-spinner-dots size="1.5rem" />
                <span class="q-ml-sm">Генерация...</span>
            </div>
        </div>

        <!-- Input -->
        <ChatInput />

        <!-- Settings dialog -->
        <SettingsDialog v-model="showSettings" />
    </q-page>
</template>

<script lang="ts">
import {
    defineComponent,
    ref,
    watch,
    nextTick,
    onMounted,
} from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useChatStore } from 'src/stores/chatStore';
import ChatInput from 'src/components/ChatInput.vue';
import SettingsDialog from 'src/components/SettingsDialog.vue';

export default defineComponent({
    name: 'ChatPage',
    components: { ChatInput, SettingsDialog },
    setup() {
        const store = useChatStore();
        const scrollRef = ref<HTMLElement | null>(null);
        const showSettings = ref(false);

        // Инициализация
        onMounted(async () => {
            await store.init();
        });

        function formatTime(ts: number): string {
            return new Date(ts).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        function renderMarkdown(text: string): string {
            const raw = marked.parse(text, { async: false }) as string;
            return DOMPurify.sanitize(raw);
        }

        // Авто-скролл при новых сообщениях
        watch(
            () => store.displayMessages.length,
            async () => {
                await nextTick();
                const el = scrollRef.value;
                if (el) {
                    el.scrollTop = el.scrollHeight;
                }
            },
        );

        // Авто-скролл во время стриминга
        watch(
            () => {
                const msgs = store.displayMessages;
                return msgs.length > 0
                    ? msgs[msgs.length - 1].content
                    : '';
            },
            async () => {
                await nextTick();
                const el = scrollRef.value;
                if (el) {
                    const isNearBottom =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 100;
                    if (isNearBottom || store.isStreaming) {
                        el.scrollTop = el.scrollHeight;
                    }
                }
            },
        );

        return {
            store,
            scrollRef,
            showSettings,
            formatTime,
            renderMarkdown,
        };
    },
});
</script>

<style scoped>
.chat-page {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.messages-area {
    flex: 1;
    overflow-y: auto;
}

.empty-state {
    height: 100%;
    min-height: 300px;
}

.markdown-body {
    line-height: 1.6;
}

/* Базовые стили markdown */
.markdown-body :deep(pre) {
    background: rgba(0, 0, 0, 0.08);
    padding: 8px 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.9em;
}

.markdown-body :deep(code) {
    font-family: monospace;
    font-size: 0.9em;
}

.markdown-body :deep(p) {
    margin: 0 0 0.5em 0;
}

.markdown-body :deep(p:last-child) {
    margin-bottom: 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
    padding-left: 1.5em;
    margin: 0.3em 0;
}

.markdown-body :deep(blockquote) {
    border-left: 3px solid rgba(0, 0, 0, 0.2);
    padding-left: 0.8em;
    margin: 0.3em 0;
    opacity: 0.8;
}
</style>
