<template>
  <q-layout view="lHh Lpr lFf" class="chatgpt-layout">
    <q-header class="chatgpt-header" elevated>
      <q-toolbar class="text-subtitle2">
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="leftDrawerOpen = !leftDrawerOpen" />
        <q-toolbar-title class="text-weight-medium">
          Simple LLM Chat
        </q-toolbar-title>
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
  </q-layout>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import SessionList from 'src/components/SessionList.vue';
import ChatSettingsDialog from 'src/components/ChatSettingsDialog.vue';

export default defineComponent({
  name: 'MainLayout',
  components: { SessionList, ChatSettingsDialog },
  setup() {
    const leftDrawerOpen = ref(true);
    const showChatSettings = ref(false);

    function onSessionSelected() {
      leftDrawerOpen.value = false;
    }

    return {
      leftDrawerOpen,
      showChatSettings,
      onSessionSelected,
    };
  },
});
</script>
