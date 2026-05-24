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
    // localStorage unavailable — ignore
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const endpoint = ref('https://api.deepseek.com/v1');
  const apiKey = ref('');
  const model = ref('deepseek-chat');
  const summaryModel = ref('deepseek-chat');
  const tokenLimit = ref(200000);
  const userFacts = ref('');
  const darkMode = ref(loadDarkMode());

  // Apply theme immediately on store init
  Dark.set(darkMode.value);

  let loaded = false;

  async function load() {
    if (loaded) return;
    const [ep, key, mdl, smdl, tkl, facts] = await Promise.all([
      getSetting('endpoint'),
      getSetting('apiKey'),
      getSetting('model'),
      getSetting('summaryModel'),
      getSetting('tokenLimit'),
      getSetting('userFacts'),
    ]);
    if (ep) endpoint.value = ep;
    if (key) apiKey.value = key;
    if (mdl) model.value = mdl;
    if (smdl) summaryModel.value = smdl;
    if (tkl) tokenLimit.value = parseInt(tkl, 10) || 200000;
    if (facts) userFacts.value = facts;
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

  async function saveUserFacts(val: string) {
    userFacts.value = val;
    await putSetting('userFacts', val);
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
    userFacts,
    darkMode,
    load,
    saveEndpoint,
    saveApiKey,
    saveModel,
    saveSummaryModel,
    saveTokenLimit,
    saveUserFacts,
    toggleDarkMode,
  };
});
