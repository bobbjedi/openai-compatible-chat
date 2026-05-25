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

function serializeFacts(arr: string[]): string {
  return JSON.stringify(arr);
}

function deserializeFacts(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (f: unknown) => typeof f === 'string' && f.trim().length > 0,
      ) as string[];
    }
    return [];
  } catch {
    return [];
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const endpoint = ref('https://api.deepseek.com/v1');
  const apiKey = ref('');
  const model = ref('deepseek-chat');
  const summaryModel = ref('deepseek-chat');
  const tokenLimit = ref(200000);
  const userFacts = ref<string[]>([]);
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
    userFacts.value = deserializeFacts(facts);
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

  async function saveUserFacts(arr: string[]) {
    userFacts.value = arr;
    await putSetting('userFacts', serializeFacts(arr));
  }

  async function addFact(fact: string) {
    const trimmed = fact.trim();
    if (!trimmed) return;
    // Don't add duplicates
    if (userFacts.value.some((f: string) => f.toLowerCase() === trimmed.toLowerCase())) return;
    const updated = [...userFacts.value, trimmed];
    await saveUserFacts(updated);
  }

  async function removeFact(index: number) {
    if (index < 0 || index >= userFacts.value.length) return;
    const updated = userFacts.value.filter((_f: string, i: number) => i !== index);
    await saveUserFacts(updated);
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
    addFact,
    removeFact,
    toggleDarkMode,
  };
});
