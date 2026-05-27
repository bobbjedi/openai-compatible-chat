м<template>
  <q-layout view="lHh Lpr lFf" class="chatgpt-layout">
    <q-header class="chatgpt-header" elevated>
      <q-toolbar class="text-subtitle2">
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="leftDrawerOpen = !leftDrawerOpen" />
        <q-toolbar-title class="text-weight-medium">
          Simple LLM Chat
        </q-toolbar-title>
        <q-btn flat dense round :icon="isSpeaking ? 'volume_up' : 'volume_down'" :color="isSpeaking ? 'positive' : ''"
          @click="isSpeaking ? undefined : toggleTts()">
          <q-tooltip>{{ isSpeaking ? 'Speaking — click for speed' : 'Read last response' }}</q-tooltip>
          <q-menu v-if="isSpeaking" anchor="bottom end" self="top end" auto-close>
            <q-list dense style="min-width: 200px">
              <q-item-label header class="text-caption text-grey-7">Speed: {{ Math.round(settingsStore.ttsRate * 100)
                }}%</q-item-label>
              <q-item>
                <q-item-section>
                  <div class="row items-center q-gutter-xs">
                    <q-btn flat dense round size="sm" icon="remove" color="negative" @click="adjustRate(-0.05)" />
                    <q-slider v-model="localTtsRate" :min="0.3" :max="2.0" :step="0.05" label-always
                      :label-value="`${Math.round(localTtsRate * 100)}%`" class="col"
                      @update:model-value="onRateChange" />
                    <q-btn flat dense round size="sm" icon="add" color="positive" @click="adjustRate(0.05)" />
                  </div>
                </q-item-section>
              </q-item>
              <q-separator />
              <q-item clickable v-close-popup @click="stopTts">
                <q-item-section class="text-negative">
                  <q-item-label>⏹ Stop speaking</q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn flat dense round icon="record_voice_over" :color="stepVoiceState.isActive.value ? 'positive' : ''"
          @click="toggleStepVoice">
          <q-tooltip>{{ stepVoiceState.isActive.value ? 'Step Voice Active' : 'Step Voice' }}</q-tooltip>
        </q-btn>
        <q-btn flat dense round icon="fact_check" @click="showFactsDialog = true">
          <q-tooltip>User Facts</q-tooltip>
        </q-btn>
        <q-btn flat dense round icon="settings" @click="showChatSettings = true">
          <q-tooltip>Chat Settings</q-tooltip>
        </q-btn>
      </q-toolbar>
      <!-- Sync notification banner -->
      <transition name="fade">
        <div v-if="syncNotification" class="chatgpt-sync-notification" :class="syncNotification.type">
          <q-icon :name="syncNotification.icon" size="xs" class="q-mr-xs" />
          <span class="text-caption">{{ syncNotification.text }}</span>
        </div>
      </transition>
    </q-header>

    <q-drawer v-model="leftDrawerOpen" show-if-above :width="260" :breakpoint="700" class="chatgpt-sidebar"
      :class="{ 'chatgpt-sidebar--closed': !leftDrawerOpen }">
      <SessionList @session-selected="onSessionSelected" />
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <!-- TTS control bar — visible while speaking -->
    <transition name="slide-up">
      <div v-if="isSpeaking" class="chatgpt-tts-bar">
        <div class="row items-center q-gutter-sm q-px-md q-py-sm">
          <q-icon name="volume_up" color="positive" size="sm" />
          <span class="text-caption text-white">Speaking</span>
          <q-space />
          <span class="text-caption text-grey-4">{{ Math.round(localTtsRate * 100) }}%</span>
          <q-btn flat dense round size="sm" icon="remove" color="white" @click="adjustRate(-0.05)" />
          <q-slider v-model="localTtsRate" :min="0.3" :max="2.0" :step="0.05" style="width: 100px" color="white"
            @update:model-value="onRateChange" />
          <q-btn flat dense round size="sm" icon="add" color="white" @click="adjustRate(0.05)" />
          <q-btn flat dense round size="sm" icon="stop" color="negative" @click="stopTts" />
        </div>
      </div>
    </transition>

    <!-- Step Voice Overlay -->
    <StepVoiceOverlay />

    <ChatSettingsDialog v-model="showChatSettings" />

    <!-- User Facts dialog -->
    <q-dialog v-model="showFactsDialog" maximized>
      <q-card class="chatgpt-facts-dialog">
        <q-bar class="bg-white text-black">
          <div class="text-subtitle2">🧠 User Facts</div>
          <q-space />
          <q-btn v-if="!editingFacts" flat dense size="sm" icon="add" color="primary" @click="startAddFact">
            <q-tooltip>Add fact</q-tooltip>
          </q-btn>
          <q-btn v-if="!editingFacts
            && settingsStore.userFacts.length > 0" flat dense size="sm" icon="edit" @click="startEditFacts">
            <q-tooltip>Edit all</q-tooltip>
          </q-btn>
          <q-btn v-else-if="editingFacts" flat dense size="sm" color="primary" icon="save" @click="saveFacts">
            <q-tooltip>Save</q-tooltip>
          </q-btn>
          <q-btn flat dense round icon="close" v-close-popup>
            <q-tooltip>Close</q-tooltip>
          </q-btn>
        </q-bar>
        <q-card-section class="chatgpt-facts-content">
          <!-- Empty state -->
          <div v-if="!editingFacts && settingsStore.userFacts.length === 0" class="chatgpt-facts-empty">
            <p class="text-grey-6">No facts yet. User Facts are automatically extracted during chat summarization and
              injected into every message context.</p>
            <p class="text-caption text-grey-5">Enable «Auto Summary» in chat settings and have at least 20 messages to
              trigger fact extraction.</p>
          </div>

          <!-- Edit all mode (textarea) -->
          <div v-if="editingFacts">
            <div class="text-caption text-grey-6 q-mb-sm">
              One fact per line. Empty lines will be removed.
            </div>
            <q-input v-model="factsText" outlined dense autogrow type="textarea" class="chatgpt-facts-input"
              placeholder="Enter facts, one per line..." />
          </div>

          <!-- List mode: each fact as a deletable row -->
          <div v-else-if="settingsStore.userFacts.length > 0">
            <q-list dense separator>
              <q-item v-for="(fact, index) in settingsStore.userFacts" :key="index" class="chatgpt-fact-item">
                <q-item-section>
                  <q-item-label>{{ fact }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn flat dense round size="xs" icon="delete" color="negative"
                    @click="settingsStore.removeFact(index)">
                    <q-tooltip>Delete</q-tooltip>
                  </q-btn>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>
  </q-layout>
</template>

<script lang="ts">
import {
  defineComponent, ref, onMounted, watch,
} from 'vue';
import SessionList from 'src/components/SessionList.vue';
import ChatSettingsDialog from 'src/components/ChatSettingsDialog.vue';
import StepVoiceOverlay from 'src/components/StepVoiceOverlay.vue';
import { useSettingsStore } from 'src/stores/settingsStore';
import { useChatStore } from 'src/stores/chatStore';
import { syncState } from 'src/services/syncService';
import { stepVoiceState, stepVoiceService } from 'src/services/stepVoiceService';

export default defineComponent({
  name: 'MainLayout',
  components: {
    SessionList, ChatSettingsDialog, StepVoiceOverlay,
  },
  setup() {
    const chatStore = useChatStore();
    const leftDrawerOpen = ref(false);
    const showChatSettings = ref(false);
    const showFactsDialog = ref(false);
    const editingFacts = ref(false);
    const factsText = ref('');

    const settingsStore = useSettingsStore();

    const syncNotification = ref<{ text: string; icon: string; type: string } | null>(null);

    function toggleStepVoice() {
      if (stepVoiceState.isActive.value) {
        stepVoiceService.stop();
      } else {
        stepVoiceService.start();
      }
    }
    let notifTimer: ReturnType<typeof setTimeout> | null = null;

    // Watch sync state for notifications
    watch(() => syncState.lastSyncAt.value, (newVal, oldVal) => {
      if (newVal && newVal !== oldVal) {
        const isUpload = !syncState.syncError.value;
        syncNotification.value = {
          text: isUpload ? '✓ Uploaded to Drive' : '✗ Sync error',
          icon: isUpload ? 'cloud_done' : 'cloud_off',
          type: isUpload ? 'positive' : 'negative',
        };
        if (notifTimer) clearTimeout(notifTimer);
        notifTimer = setTimeout(() => { syncNotification.value = null; }, 3000);
      }
    });

    onMounted(async () => {
      await settingsStore.load();
    });

    function startEditFacts() {
      factsText.value = settingsStore.userFacts.join('\n');
      editingFacts.value = true;
    }

    function startAddFact() {
      factsText.value = settingsStore.userFacts.join('\n');
      editingFacts.value = true;
    }

    async function saveFacts() {
      const lines = factsText.value
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);
      await settingsStore.saveUserFacts(lines);
      editingFacts.value = false;
    }

    const isSpeaking = ref(false);
    const localTtsRate = ref(1.0);

    // Загружаем сохранённую скорость из IndexedDB
    onMounted(async () => {
      await settingsStore.load();
      localTtsRate.value = settingsStore.ttsRate;
    });

    function adjustRate(delta: number) {
      const newRate = Math.round(Math.min(2.0, Math.max(0.3, localTtsRate.value + delta)) * 100) / 100;
      localTtsRate.value = newRate;
      settingsStore.saveTtsRate(newRate);
    }

    function onRateChange(val: number | null) {
      if (val !== null) settingsStore.saveTtsRate(val);
    }

    function stopTts() {
      window.speechSynthesis.cancel();
      isSpeaking.value = false;
    }

    function toggleTts() {
      if (isSpeaking.value) {
        window.speechSynthesis.cancel();
        isSpeaking.value = false;
        return;
      }

      // Find last assistant message with content
      const msgs = chatStore.displayMessages;
      let lastAssistant = '';
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        if (msgs[i].role === 'assistant' && msgs[i].content) {
          lastAssistant = msgs[i].content;
          break;
        }
      }

      if (!lastAssistant) return;

      // Clean markdown for speech
      const cleanText = lastAssistant
        .replace(/[#*_`[\]()>|~]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim();

      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'ru-RU';
      utterance.rate = settingsStore.ttsRate;
      utterance.pitch = 1.0;

      utterance.onend = () => {
        isSpeaking.value = false;
      };

      utterance.onerror = () => {
        isSpeaking.value = false;
      };

      isSpeaking.value = true;
      window.speechSynthesis.speak(utterance);
    }

    function onSessionSelected() {
      leftDrawerOpen.value = false;
    }

    return {
      leftDrawerOpen,
      showChatSettings,
      showFactsDialog,
      editingFacts,
      factsText,
      settingsStore,
      startEditFacts,
      startAddFact,
      saveFacts,
      isSpeaking,
      localTtsRate,
      adjustRate,
      onRateChange,
      stopTts,
      toggleTts,
      syncNotification,
      stepVoiceState,
      toggleStepVoice,
      onSessionSelected,
    };
  },
});
</script>
