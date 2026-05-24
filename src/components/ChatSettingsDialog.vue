<template>
    <q-dialog v-model="visible" persistent>
        <q-card class="chatgpt-dialog" style="min-width: 420px">
            <q-card-section class="row items-center q-pb-none">
                <div class="text-h6">Chat Settings</div>
                <q-space />
                <q-btn flat round dense icon="close" v-close-popup />
            </q-card-section>

            <q-card-section class="q-gutter-md">
                <p class="text-caption text-grey-6">
                    Chat-specific settings will appear here.
                </p>
            </q-card-section>

            <q-card-actions align="right">
                <q-btn flat label="Close" color="primary" v-close-popup />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
    name: 'ChatSettingsDialog',
    props: {
        modelValue: { type: Boolean, default: false },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const visible = computed({
            get: () => props.modelValue,
            set: (val) => emit('update:modelValue', val),
        });
        return { visible };
    },
});
</script>
