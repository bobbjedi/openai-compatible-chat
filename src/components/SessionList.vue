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
                        <q-item-label class="chatgpt-session-title">
                            {{ truncate(s.title, 24) }}
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

        <!-- Bottom bar: Settings + Dark Mode + Sync -->
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
                <!-- Sync: Sign in (if not signed in) -->
                <q-item v-if="!syncState.isSignedIn.value" clickable v-ripple @click="handleSignIn">
                    <q-item-section avatar>
                        <q-icon name="cloud_upload" color="primary" size="xs" />
                    </q-item-section>
                    <q-item-section class="text-primary">Sign in to Drive</q-item-section>
                </q-item>
                <!-- Sync: buttons (if signed in) -->
                <template v-if="syncState.isSignedIn.value">
                    <q-item clickable v-ripple :disable="syncState.isSyncing.value" @click="handleSyncNow">
                        <q-item-section avatar>
                            <q-icon :name="syncState.isSyncing.value
                                ? 'cloud_sync' : 'cloud_upload'" color="positive" size="xs" />
                        </q-item-section>
                        <q-item-section class="text-positive">
                            {{ syncState.isSyncing.value ? 'Uploading...' : 'Upload' }}
                        </q-item-section>
                    </q-item>
                    <q-item clickable v-ripple :disable="syncState.isSyncing.value" @click="confirmPull = true">
                        <q-item-section avatar>
                            <q-icon name="cloud_download" color="warning" size="xs" />
                        </q-item-section>
                        <q-item-section class="text-warning">Download</q-item-section>
                    </q-item>
                    <!-- Sync status -->
                    <q-item v-if="syncState.lastSyncAt.value" dense class="chatgpt-sync-status">
                        <q-item-section avatar>
                            <q-icon :name="syncIcon" :color="syncColor" size="xs" />
                        </q-item-section>
                        <q-item-section class="text-caption">
                            {{ syncLabel }}
                        </q-item-section>
                    </q-item>
                </template>
            </q-list>
            <div class="chatgpt-sidebar-version text-caption text-grey-6 q-px-md q-pb-sm">
                v{{ appVersion }}
            </div>
        </div>

        <!-- Pull confirmation dialog -->
        <q-dialog v-model="confirmPull" persistent>
            <q-card>
                <q-card-section class="row items-center">
                    <q-icon name="warning" color="warning" size="md" class="q-mr-md" />
                    <div>
                        <div class="text-h6">Download from Drive?</div>
                        <div class="text-caption text-grey-7">
                            This will <strong>replace all local data</strong> with data from Google Drive.
                        </div>
                    </div>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Cancel" v-close-popup />
                    <q-btn flat label="Download & Replace" color="warning" :loading="syncState.isSyncing.value"
                        @click="handlePull" />
                </q-card-actions>
            </q-card>
        </q-dialog>

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
import { defineComponent, ref, computed } from 'vue';
import { useChatStore, type Session } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { syncService, syncState } from 'src/services/syncService';
import { googleDriveProvider } from 'src/services/googleDriveProvider';
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
        const confirmPull = ref(false);

        const appVersion: string = pkg.version;

        // Sync status indicators
        const syncIcon = computed(() => {
            if (syncState.isSyncing.value) return 'cloud_sync';
            if (syncState.lastSyncAt.value) return 'cloud_done';
            return 'cloud';
        });

        const syncColor = computed(() => {
            if (syncState.isSyncing.value) return 'primary';
            if (syncState.syncError.value) return 'negative';
            if (syncState.lastSyncAt.value) return 'positive';
            return 'grey';
        });

        const syncLabel = computed(() => {
            if (syncState.isSyncing.value) return 'Syncing...';
            if (syncState.syncError.value) return 'Sync error';
            if (syncState.lastSyncAt.value) {
                const diff = Date.now() - syncState.lastSyncAt.value;
                if (diff < 60000) return 'Synced just now';
                if (diff < 3600000) return `Synced ${Math.floor(diff / 60000)}m ago`;
                if (diff < 86400000) return `Synced ${Math.floor(diff / 3600000)}h ago`;
                return 'Synced';
            }
            return 'Not synced';
        });

        function truncate(str: string, maxLen: number): string {
            if (str.length <= maxLen) return str;
            return `${str.slice(0, maxLen - 1)}…`;
        }

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

        async function handleSignIn() {
            try {
                await googleDriveProvider.signIn();
                syncService.updateAuthState();
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Sign in failed';
            }
        }

        async function handleSyncNow() {
            await syncService.pushAll(
                () => store.sessions,
                (sessionId: string) => {
                    if (sessionId === store.currentSessionId) {
                        return store.messages;
                    }
                    return [];
                },
                () => settingsStore.userFacts,
                () => appVersion,
            );
        }

        async function handlePull() {
            confirmPull.value = false;
            try {
                await syncService.pullAll(
                    () => store.sessions,
                    (sessionId: string) => {
                        if (sessionId === store.currentSessionId) {
                            return store.messages;
                        }
                        return [];
                    },
                    (sessions) => {
                        store.sessions.splice(0, store.sessions.length, ...sessions);
                    },
                    (sessionId, messages) => {
                        if (sessionId === store.currentSessionId) {
                            store.messages.splice(0, store.messages.length, ...messages);
                        }
                    },
                    (facts) => {
                        settingsStore.saveUserFacts(facts);
                    },
                );
            } catch (err) {
                // Error is already set in syncState
            }
        }

        return {
            store,
            settingsStore,
            syncState,
            renameDialog,
            renameTitle,
            showSettings,
            appVersion,
            syncIcon,
            syncColor,
            syncLabel,
            truncate,
            startRename,
            confirmRename,
            selectChat,
            newChat,
            confirmPull,
            handleSignIn,
            handleSyncNow,
            handlePull,
        };
    },
});
</script>
