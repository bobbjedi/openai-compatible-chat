<template>
    <div class="chatgpt-input-wrapper">
        <div class="chatgpt-input-inner">
            <q-input v-model="text" outlined dense autogrow placeholder="Message ChatGPT..."
                :disable="store.isStreaming" class="chatgpt-input" @keydown.enter.exact.prevent="submit">
                <template #append>
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

export default defineComponent({
    name: 'ChatInput',
    setup() {
        const store = useChatStore();
        const text = ref('');

        function submit() {
            const val = text.value.trim();
            if (!val || store.isStreaming) return;
            text.value = '';
            void store.sendMessage(val);
        }

        return { text, store, submit };
    },
});
</script>
