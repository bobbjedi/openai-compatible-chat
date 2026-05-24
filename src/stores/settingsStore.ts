import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getSetting, putSetting } from 'src/services/db';
import { Dark } from 'quasar';

const DARK_MODE_KEY = 'chatgpt-dark-mode';

function loadDarkMode(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveDarkMode(val: boolean): void {
  try {
    localStorage.setItem(DARK_MODE_KEY, String(val));
  } catch {
    // localStorage недоступен — игнорируем
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const endpoint = ref('https://api.deepseek.com/v1');
  const apiKey = ref('');
  const model = ref('deepseek-chat');
  const summaryModel = ref('deepseek-chat');
  const tokenLimit = ref(200000);
  const darkMode = ref(loadDarkMode());

  // Применяем тему сразу при инициализации стора
  Dark.set(darkMode.value);

  let loaded = false;

  async function load() {
    if (loaded) return;
    const [ep, key, mdl, smdl, tkl] = await Promise.all([
      getSetting('endpoint'),
      getSetting('apiKey'),
      getSetting('model'),
      getSetting('summaryModel'),
      getSetting('tokenLimit'),
    ]);
    if (ep) endpoint.value = ep;
    if (key) apiKey.value = key;
    if (mdl) model.value = mdl;
    if (smdl) summaryModel.value = smdl;
    if (tkl) tokenLimit.value = parseInt(tkl, 10) || 200000;
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

  async function saveSummaryModel(val: string) {
    summaryModel.value = val;
    await putSetting('summaryModel', val);
  }

  async function saveTokenLimit(val: number) {
    tokenLimit.value = val;
    await putSetting('tokenLimit', String(val));
  }

  function toggleDarkMode() {
    darkMode.value = !darkMode.value;
    Dark.set(darkMode.value);
    saveDarkMode(darkMode.value);
  }

  return {
    endpoint,
    apiKey,
    model,
    summaryModel,
    tokenLimit,
    darkMode,
    load,
    saveEndpoint,
    saveApiKey,
    saveModel,
    saveSummaryModel,
    saveTokenLimit,
    toggleDarkMode,
  };
});
