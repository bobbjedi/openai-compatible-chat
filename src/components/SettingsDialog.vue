<template>
  <q-dialog v-model="visible" persistent>
    <q-card class="chatgpt-dialog" style="min-width: 440px">
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

        <q-select v-model="localModel" outlined dense label="Model" :options="modelOptions" use-input input-debounce="0"
          behavior="dialog" hint="Select from list or type a custom model" @filter="filterModels"
          @input-value="onModelInput" clearable>
          <template #no-option>
            <q-item>
              <q-item-section class="text-grey">
                No matching models
              </q-item-section>
            </q-item>
          </template>
        </q-select>

        <q-input v-model.number="localTokenLimit" outlined dense label="Token Limit" type="number"
          hint="Max context tokens (default 200 000)" :min="1000" :max="2000000" step="1000" />

        <q-separator spaced />

        <div class="text-subtitle2 text-grey-8 q-mb-sm">Summary Model</div>
        <q-select v-model="localSummaryModel" outlined dense label="Model for summaries" :options="modelOptions"
          use-input input-debounce="0" behavior="dialog"
          hint="Модель для генерации саммари (если не задана — используется основная)" @filter="filterModels" clearable>
          <template #no-option>
            <q-item>
              <q-item-section class="text-grey">
                No matching models
              </q-item-section>
            </q-item>
          </template>
        </q-select>
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

const KNOWN_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-chat',
  'deepseek-reasoner',
];

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
    const localSummaryModel = ref(store.summaryModel);
    const localTokenLimit = ref(store.tokenLimit);
    const showKey = ref(false);
    const modelOptions = ref([...KNOWN_MODELS]);

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
        localSummaryModel.value = store.summaryModel;
        localTokenLimit.value = store.tokenLimit;
      }
    });

    const isValid = computed(
      () => localEndpoint.value.trim().length > 0
        && localModel.value.trim().length > 0,
    );

    /* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
    function filterModels(inputValue: string, update: (fn: () => void) => void) {
      update(() => {
        const needle = inputValue.toLowerCase();
        modelOptions.value = KNOWN_MODELS.filter(
          (m) => m.toLowerCase().indexOf(needle) > -1,
        );
      });
    }
    /* eslint-enable @typescript-eslint/no-unused-vars, no-unused-vars */

    function onModelInput(val: string) {
      localModel.value = val;
    }

    async function save() {
      await Promise.all([
        store.saveEndpoint(localEndpoint.value.trim()),
        store.saveApiKey(localApiKey.value.trim()),
        store.saveModel(localModel.value.trim()),
        store.saveSummaryModel(localSummaryModel.value.trim()),
        store.saveTokenLimit(localTokenLimit.value || 200000),
      ]);
      emit('update:modelValue', false);
    }

    return {
      localEndpoint,
      localApiKey,
      localModel,
      localSummaryModel,
      localTokenLimit,
      showKey,
      modelOptions,
      visible,
      isValid,
      filterModels,
      onModelInput,
      save,
    };
  },
});
</script>
