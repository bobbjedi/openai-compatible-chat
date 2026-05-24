import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getSetting, putSetting } from 'src/services/db';

export const useSettingsStore = defineStore('settings', () => {
  const endpoint = ref('https://api.deepseek.com/v1');
  const apiKey = ref('');
  const model = ref('deepseek-chat');

  let loaded = false;

  async function load() {
    if (loaded) return;
    const [ep, key, mdl] = await Promise.all([
      getSetting('endpoint'),
      getSetting('apiKey'),
      getSetting('model'),
    ]);
    if (ep) endpoint.value = ep;
    if (key) apiKey.value = key;
    if (mdl) model.value = mdl;
    loaded = true;
  }

  async function saveEndpoint(val: string) {
    endpoint.value = val;
    await putSetting('endpoint', val);
  }

  async function saveApiKey(val: string) {
    apiKey.value = val;
    await putSetting('apiKey', val);
  }

  async function saveModel(val: string) {
    model.value = val;
    await putSetting('model', val);
  }

  return {
    endpoint,
    apiKey,
    model,
    load,
    saveEndpoint,
    saveApiKey,
    saveModel,
  };
});
