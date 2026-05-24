import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getSetting, putSetting } from 'src/services/db';
import { Dark } from 'quasar';

export const useSettingsStore = defineStore('settings', () => {
  const endpoint = ref('https://api.deepseek.com/v1');
  const apiKey = ref('');
  const model = ref('deepseek-chat');
  const darkMode = ref(false);

  let loaded = false;

  async function load() {
    if (loaded) return;
    const [ep, key, mdl, dm] = await Promise.all([
      getSetting('endpoint'),
      getSetting('apiKey'),
      getSetting('model'),
      getSetting('darkMode'),
    ]);
    if (ep) endpoint.value = ep;
    if (key) apiKey.value = key;
    if (mdl) model.value = mdl;
    darkMode.value = dm === 'true';
    Dark.set(darkMode.value);
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

  async function toggleDarkMode() {
    darkMode.value = !darkMode.value;
    Dark.set(darkMode.value);
    await putSetting('darkMode', String(darkMode.value));
  }

  return {
    endpoint,
    apiKey,
    model,
    darkMode,
    load,
    saveEndpoint,
    saveApiKey,
    saveModel,
    toggleDarkMode,
  };
});
