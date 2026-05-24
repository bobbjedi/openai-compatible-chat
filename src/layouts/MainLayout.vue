<template>
  <q-layout view="lHh Lpr lFf" class="chatgpt-layout">
    <q-header class="chatgpt-header" elevated>
      <q-toolbar class="text-subtitle2">
        <q-btn flat dense round icon="menu" aria-label="Menu" @click="leftDrawerOpen = !leftDrawerOpen" />
        <q-toolbar-title class="text-weight-medium">ChatGPT</q-toolbar-title>
        <q-btn flat dense round icon="settings">
          <q-tooltip>Settings</q-tooltip>
          <q-menu v-model="menuOpen" anchor="bottom right" self="top right" class="chatgpt-settings-menu">
            <q-list>
              <q-item clickable v-ripple @click="openSettingsDialog">
                <q-item-section avatar>
                  <q-icon name="tune" />
                </q-item-section>
                <q-item-section>API Settings</q-item-section>
              </q-item>
              <q-item clickable v-ripple @click="settingsStore.toggleDarkMode()">
                <q-item-section avatar>
                  <q-icon :name="settingsStore.darkMode ? 'dark_mode' : 'light_mode'" />
                </q-item-section>
                <q-item-section>{{ settingsStore.darkMode ? 'Light Mode' : 'Dark Mode' }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="leftDrawerOpen" show-if-above :width="260" :breakpoint="700" class="chatgpt-sidebar"
      :class="{ 'chatgpt-sidebar--closed': !leftDrawerOpen }">
      <SessionList />
    </q-drawer>

    <q-page-container>
      <router-view />
    </q-page-container>

    <SettingsDialog v-model="showSettings" />
  </q-layout>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import SessionList from 'src/components/SessionList.vue';
import SettingsDialog from 'src/components/SettingsDialog.vue';
import { useSettingsStore } from 'src/stores/settingsStore';

export default defineComponent({
  name: 'MainLayout',
  components: { SessionList, SettingsDialog },
  setup() {
    const leftDrawerOpen = ref(true);
    const menuOpen = ref(false);
    const showSettings = ref(false);
    const settingsStore = useSettingsStore();

    function openSettingsDialog() {
      menuOpen.value = false;
      showSettings.value = true;
    }

    return {
      leftDrawerOpen, menuOpen, showSettings, settingsStore, openSettingsDialog,
    };
  },
});
</script>
