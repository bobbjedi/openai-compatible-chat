<template>
  <q-layout view="lHh Lpr lFf" class="chatgpt-layout">
    <q-header class="chatgpt-header" elevated>
      <q-toolbar class="text-subtitle2">
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="leftDrawerOpen = !leftDrawerOpen" />
        <q-toolbar-title class="text-weight-medium">
          Simple LLM Chat
        </q-toolbar-title>
        <q-btn flat dense round icon="fact_check" @click="showFactsDialog = true">
          <q-tooltip>User Facts</q-tooltip>
        </q-btn>
        <q-btn flat dense round icon="settings" @click="showChatSettings = true">
          <q-tooltip>Chat Settings</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="leftDrawerOpen" show-if-above :width="260" :breakpoint="700" class="chatgpt-sidebar"
      :class="{ 'chatgpt-sidebar--closed': !leftDrawerOpen }">
      <SessionList @session-selected="onSessionSelected" />
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

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
  defineComponent, ref, onMounted,
} from 'vue';
import SessionList from 'src/components/SessionList.vue';
import ChatSettingsDialog from 'src/components/ChatSettingsDialog.vue';
import { useSettingsStore } from 'src/stores/settingsStore';

export default defineComponent({
  name: 'MainLayout',
  components: { SessionList, ChatSettingsDialog },
  setup() {
    const leftDrawerOpen = ref(true);
    const showChatSettings = ref(false);
    const showFactsDialog = ref(false);
    const editingFacts = ref(false);
    const factsText = ref('');

    const settingsStore = useSettingsStore();

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
      onSessionSelected,
    };
  },
});
</script>
