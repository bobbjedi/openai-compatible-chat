<template>
    <q-dialog v-model="visible" persistent>
        <q-card class="chatgpt-dialog" style="width: 440px">
            <q-card-section class="row items-center q-pb-sm">
                <div class="text-h6">Chat Settings</div>
                <q-space />
                <q-btn flat round dense icon="close" v-close-popup />
            </q-card-section>

            <q-card-section class="q-px-md q-gutter-sm q-pt-none">
                <!-- Auto-summary toggle -->
                <div class="row items-center q-mb-sm">
                    <div>
                        <div class="text-subtitle2 text-grey-8">Auto Summary</div>
                        <div class="text-caption text-grey-6">Preserves context of long conversations via periodic
                            summarization</div>
                    </div>
                    <q-space />
                    <q-toggle v-model="localSummaryEnabled" color="primary" />
                </div>

                <q-separator spaced />

                <!-- System prompt -->
                <div class="text-subtitle2 text-grey-8 q-mb-xs">System Prompt</div>
                <q-input v-model="localPrompt" type="textarea" outlined dense autogrow
                    placeholder="Enter system instructions (e.g. «You are a helpful assistant, answer concisely»)."
                    hint="Sent as a system message at the beginning of each request." :rules="[]" :maxlength="10000"
                    counter />

                <!-- Load from file -->
                <div class="row items-center q-col-gutter-sm">
                    <div class="col">
                        <q-file v-model="file" outlined dense label="Load from file (.txt)" accept=".txt,text/plain"
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
        const localSummaryEnabled = ref(false);
        const file = ref<File | null>(null);

        // When dialog opens, populate with current values from active session
        watch(visible, (isOpen) => {
            if (isOpen) {
                localPrompt.value = store.currentSession?.systemPrompt ?? '';
                localSummaryEnabled.value = store.currentSession?.summaryEnabled ?? false;
                file.value = null;
            }
        });

        async function onFileSelected(f: File | null) {
            if (!f) return;
            try {
                const text = await f.text();
                localPrompt.value = text.slice(0, 10000);
                file.value = f; // keep reference so q-file shows the name
            } catch {
                // Read error — ignore
            }
        }

        async function saveAndClose() {
            const prompt = localPrompt.value.trim();
            await store.updateSystemPrompt(prompt || undefined);
            await store.updateSummaryEnabled(localSummaryEnabled.value);
            emit('update:modelValue', false);
        }

        return {
            visible,
            localPrompt,
            localSummaryEnabled,
            file,
            onFileSelected,
            saveAndClose,
        };
    },
});
</script>
