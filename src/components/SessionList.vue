<template>
    <div class="chatgpt-sessions">
        <!-- New chat button -->
        <div class="q-pa-sm">
            <q-btn no-caps class="chatgpt-new-btn full-width" @click="newChat">
                <q-icon name="add" size="xs" class="q-mr-sm" />
                <span>New chat</span>
            </q-btn>
        </div>

        <!-- Session list -->
        <q-scroll-area class="chatgpt-sessions-scroll">
            <q-list dense>
                <q-item v-for="s in store.sessions" :key="s.id" clickable v-ripple
                    :active="s.id === store.currentSessionId" active-class="chatgpt-session--active"
                    class="chatgpt-session q-mx-xs" @click="selectChat(s.id)">
                    <q-item-section avatar class="q-mr-xs">
                        <q-icon name="chat_bubble_outline" size="xs" />
                    </q-item-section>
                    <q-item-section>
                        <q-item-label lines="1" class="chatgpt-session-title">
                            {{ s.title }}
                        </q-item-label>
                    </q-item-section>
                    <q-item-section side>
                        <q-btn flat dense round size="0.5rem" icon="more_horiz" class="chatgpt-session-more"
                            @click.stop>
                            <q-menu auto-close anchor="bottom end" self="top end" class="chatgpt-menu">
                                <q-list dense>
                                    <q-item clickable @click="startRename(s)">
                                        <q-item-section>Rename</q-item-section>
                                    </q-item>
                                    <q-item clickable @click="store.removeSession(s.id)">
                                        <q-item-section class="text-negative">
                                            Delete
                                        </q-item-section>
                                    </q-item>
                                </q-list>
                            </q-menu>
                        </q-btn>
                    </q-item-section>
                </q-item>
            </q-list>

            <div v-if="store.sessions.length === 0" class="chatgpt-empty text-center q-pa-lg">
                <p class="text-caption text-grey">No conversations yet</p>
            </div>
        </q-scroll-area>

        <!-- Bottom bar: Settings + Dark Mode -->
        <div class="chatgpt-sidebar-footer">
            <q-list dense>
                <q-item clickable v-ripple @click="showSettings = true">
                    <q-item-section avatar>
                        <q-icon name="tune" size="xs" />
                    </q-item-section>
                    <q-item-section>Settings</q-item-section>
                </q-item>
                <q-item clickable v-ripple @click="settingsStore.toggleDarkMode()">
                    <q-item-section avatar>
                        <q-icon :name="settingsStore.darkMode
                            ? 'dark_mode' : 'light_mode'" size="xs" />
                    </q-item-section>
                    <q-item-section>
                        {{ settingsStore.darkMode ? 'Light Mode' : 'Dark Mode' }}
                    </q-item-section>
                </q-item>
            </q-list>
            <div class="chatgpt-sidebar-version text-caption text-grey-6 q-px-md q-pb-sm">
                v{{ appVersion }}
            </div>
        </div>

        <!-- Rename dialog -->
        <q-dialog v-model="renameDialog" persistent>
            <q-card class="chatgpt-dialog" style="min-width: 300px">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6">Rename</div>
                    <q-space />
                    <q-btn flat round dense icon="close" v-close-popup />
                </q-card-section>
                <q-card-section>
                    <q-input v-model="renameTitle" dense outlined autofocus label="Chat name"
                        @keydown.enter.prevent="confirmRename" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Cancel" v-close-popup />
                    <q-btn flat label="OK" color="primary" @click="confirmRename" />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Settings dialog -->
        <SettingsDialog v-model="showSettings" />
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useChatStore, type Session } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import SettingsDialog from 'src/components/SettingsDialog.vue';

const pkg = require('../../package.json');

export default defineComponent({
    name: 'SessionList',
    components: { SettingsDialog },
    emits: ['session-selected'],
    setup(_props, { emit }) {
        const store = useChatStore();
        const settingsStore = useSettingsStore();
        const renameDialog = ref(false);
        const renameId = ref<string | null>(null);
        const renameTitle = ref('');
        const showSettings = ref(false);

        const appVersion: string = pkg.version;

        function startRename(s: Session) {
            renameId.value = s.id;
            renameTitle.value = s.title;
            renameDialog.value = true;
        }

        async function confirmRename() {
            if (renameId.value && renameTitle.value.trim()) {
                await store.renameSession(
                    renameId.value,
                    renameTitle.value.trim(),
                );
            }
            renameDialog.value = false;
        }

        async function selectChat(id: string) {
            await store.selectSession(id);
            emit('session-selected');
        }

        async function newChat() {
            await store.createSession();
            emit('session-selected');
        }

        return {
            store,
            settingsStore,
            renameDialog,
            renameTitle,
            showSettings,
            appVersion,
            startRename,
            confirmRename,
            selectChat,
            newChat,
        };
    },
});
</script>
