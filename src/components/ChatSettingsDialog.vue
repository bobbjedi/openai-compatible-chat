<template>
    <q-dialog v-model="visible" persistent>
        <q-card class="chatgpt-dialog" style="width: 440px">
            <q-card-section class="row items-center q-pb-sm">
                <div class="text-h6">Chat Settings</div>
                <q-space />
                <q-btn flat round dense icon="close" v-close-popup />
            </q-card-section>

            <q-card-section class="q-px-md q-gutter-sm q-pt-none">
                <!-- System prompt (инструкция) -->
                <div class="text-subtitle2 text-grey-8 q-mb-xs">System Prompt</div>
                <q-input v-model="localPrompt" type="textarea" outlined dense autogrow
                    placeholder="Введите инструкцию для модели (например: «Ты — полезный ассистент, отвечай кратко»)."
                    hint="Передаётся как system-сообщение в начале каждого запроса." :rules="[]" :maxlength="4000"
                    counter />

                <!-- Загрузка из файла -->
                <div class="row items-center q-col-gutter-sm">
                    <div class="col">
                        <q-file v-model="file" outlined dense label="Загрузить из файла (.txt)" accept=".txt,text/plain"
                            max-file-size="1048576" @update:model-value="onFileSelected" clearable>
                            <template v-slot:prepend>
                                <q-icon name="attach_file" />
                            </template>
                        </q-file>
                    </div>
                </div>
            </q-card-section>

            <q-card-actions align="right" class="q-gutter-sm">
                <q-btn flat label="Cancel" color="grey" v-close-popup />
                <q-btn flat label="Save" color="primary" @click="saveAndClose" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script lang="ts">
import {
    defineComponent, ref, watch, computed,
} from 'vue';
import { useChatStore } from 'src/stores/chatStore';

export default defineComponent({
    name: 'ChatSettingsDialog',
    props: {
        modelValue: { type: Boolean, default: false },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const store = useChatStore();

        const visible = computed({
            get: () => props.modelValue,
            set: (val) => emit('update:modelValue', val),
        });

        const localPrompt = ref('');
        const file = ref<File | null>(null);

        // При открытии диалога заполняем текущим значением из активной сессии
        watch(visible, (isOpen) => {
            if (isOpen) {
                localPrompt.value = store.currentSession?.systemPrompt ?? '';
                file.value = null;
            }
        });

        async function onFileSelected(f: File | null) {
            if (!f) return;
            try {
                const text = await f.text();
                localPrompt.value = text.slice(0, 4000);
                file.value = f; // сохраняем, чтобы q-file показал имя
            } catch {
                // Ошибка чтения — игнорируем
            }
        }

        async function saveAndClose() {
            const prompt = localPrompt.value.trim();
            await store.updateSystemPrompt(prompt || undefined);
            emit('update:modelValue', false);
        }

        return {
            visible,
            localPrompt,
            file,
            onFileSelected,
            saveAndClose,
        };
    },
});
</script>
