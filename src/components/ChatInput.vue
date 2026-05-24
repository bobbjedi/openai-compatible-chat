<template>
    <div class="chat-input">
        <q-input v-model="text" outlined dense autogrow placeholder="Введите сообщение..." :disable="store.isStreaming"
            @keydown.enter.prevent="submit" @keydown.tab.prevent="submit">
            <template #append>
                <q-btn v-if="store.isStreaming" flat dense round icon="stop" color="negative"
                    @click="store.cancelStream()">
                    <q-tooltip>Остановить генерацию</q-tooltip>
                </q-btn>
                <q-btn v-else flat dense round icon="send" color="primary" :disable="!text.trim()" @click="submit">
                    <q-tooltip>Отправить</q-tooltip>
                </q-btn>
            </template>
        </q-input>
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
            store.sendMessage(val);
        }

        return { text, store, submit };
    },
});
</script>

<style scoped>
.chat-input {
    padding: 8px 12px;
}
</style>
