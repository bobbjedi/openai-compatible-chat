<template>
  <q-dialog v-model="visible" persistent>
    <q-card class="chatgpt-dialog" style="min-width: 420px">
      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Settings</div>
        <q-space />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-card-section>

      <q-card-section class="q-gutter-md">
        <q-input v-model="localEndpoint" outlined dense label="API Endpoint" hint="e.g. https://api.deepseek.com/v1" />
        <q-input v-model="localApiKey" outlined dense label="API Key" :type="showKey ? 'text' : 'password'"
          hint="Your API key">
          <template #append>
            <q-btn flat dense round :icon="showKey ? 'visibility_off' : 'visibility'" @click="showKey = !showKey" />
          </template>
        </q-input>
        <q-input v-model="localModel" outlined dense label="Model" hint="e.g. deepseek-chat, gpt-4o-mini" />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn flat label="Save" color="primary" :disable="!isValid" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import {
  defineComponent, ref, computed, watch,
} from 'vue';
import { useSettingsStore } from 'src/stores/settingsStore';

export default defineComponent({
  name: 'SettingsDialog',
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const store = useSettingsStore();

    const localEndpoint = ref(store.endpoint);
    const localApiKey = ref(store.apiKey);
    const localModel = ref(store.model);
    const showKey = ref(false);

    const visible = computed({
      get: () => props.modelValue,
      set: (val) => emit('update:modelValue', val),
    });

    watch(visible, async (val) => {
      if (val) {
        await store.load();
        localEndpoint.value = store.endpoint;
        localApiKey.value = store.apiKey;
        localModel.value = store.model;
      }
    });

    const isValid = computed(
      () => localEndpoint.value.trim().length > 0
        && localModel.value.trim().length > 0,
    );

    async function save() {
      await Promise.all([
        store.saveEndpoint(localEndpoint.value.trim()),
        store.saveApiKey(localApiKey.value.trim()),
        store.saveModel(localModel.value.trim()),
      ]);
      emit('update:modelValue', false);
    }

    return {
      localEndpoint,
      localApiKey,
      localModel,
      showKey,
      visible,
      isValid,
      save,
    };
  },
});
</script>
