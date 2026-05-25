<template>
    <div class="q-gutter-md">
        <q-separator spaced />

        <div class="text-subtitle2 text-grey-8 q-mb-sm">Google Drive Sync</div>

        <!-- Not signed in -->
        <div v-if="!isSignedIn">
            <p class="text-caption text-grey-6 q-mb-sm">
                Sync your chats, user facts, and session settings to Google Drive.
                Your API keys stay local and are never uploaded.
            </p>
            <q-btn outline color="primary" icon="cloud_upload" label="Sign in with Google" :loading="signingIn"
                @click="handleSignIn" />
        </div>

        <!-- Signed in -->
        <div v-else>
            <div class="row items-center q-mb-sm">
                <q-icon name="check_circle" color="positive" size="sm" class="q-mr-sm" />
                <span class="text-body2">Signed in as <strong>{{ userEmail }}</strong></span>
                <q-space />
                <q-btn flat dense size="sm" color="negative" label="Sign Out" :loading="signingOut"
                    @click="handleSignOut" />
            </div>

            <!-- Auto Sync toggle -->
            <q-toggle v-model="autoSync" dense label="Auto Sync" hint="Automatically sync changes to Google Drive"
                @update:model-value="onAutoSyncChange" />

            <!-- Sync buttons -->
            <div class="row q-gutter-sm q-mt-sm">
                <q-btn outline color="primary" icon="cloud_upload" label="Sync Now" :disable="isSyncing"
                    :loading="isSyncing" @click="handleSyncNow" />
                <q-btn outline color="warning" icon="cloud_download" label="Sync from Drive" :disable="isSyncing"
                    @click="confirmPull = true" />
            </div>

            <!-- Last sync status -->
            <div v-if="lastSyncAt" class="text-caption text-grey-6 q-mt-sm">
                Last synced: {{ formatTime(lastSyncAt) }}
            </div>
            <div v-if="syncError" class="text-caption text-negative q-mt-xs">
                Error: {{ syncError }}
            </div>
        </div>

        <!-- Pull confirmation dialog -->
        <q-dialog v-model="confirmPull" persistent>
            <q-card>
                <q-card-section class="row items-center">
                    <q-icon name="warning" color="warning" size="md" class="q-mr-md" />
                    <div>
                        <div class="text-h6">Sync from Drive?</div>
                        <div class="text-caption text-grey-7">
                            This will <strong>replace all local data</strong> with the data from Google Drive.
                            Current local changes that haven't been synced will be lost.
                        </div>
                    </div>
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Cancel" v-close-popup />
                    <q-btn flat label="Replace & Sync" color="warning" :loading="isSyncing" @click="handlePull" />
                </q-card-actions>
            </q-card>
        </q-dialog>
    </div>
</template>

<script lang="ts">
import {
    defineComponent, ref, computed, onMounted,
} from 'vue';
import { googleDriveProvider } from 'src/services/googleDriveProvider';
import { syncService, syncState } from 'src/services/syncService';
import { useSettingsStore } from 'src/stores/settingsStore';
import { useChatStore } from 'src/stores/chatStore';

export default defineComponent({
    name: 'SyncSettings',

    setup() {
        const settingsStore = useSettingsStore();
        const chatStore = useChatStore();

        const signingIn = ref(false);
        const signingOut = ref(false);
        const confirmPull = ref(false);
        const autoSync = ref(settingsStore.googleDriveEnabled);

        const isSignedIn = computed(() => syncState.isSignedIn.value);
        const userEmail = computed(() => syncState.userEmail.value);
        const isSyncing = computed(() => syncState.isSyncing.value);
        const lastSyncAt = computed(() => syncState.lastSyncAt.value);
        const syncError = computed(() => syncState.syncError.value);

        onMounted(() => {
            syncService.updateAuthState();
        });

        function formatTime(ts: number): string {
            const diff = Date.now() - ts;
            if (diff < 60000) return 'just now';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)} h ago`;
            return new Date(ts).toLocaleDateString();
        }

        async function handleSignIn() {
            signingIn.value = true;
            try {
                const { email } = await googleDriveProvider.signIn();
                syncService.updateAuthState();
                await settingsStore.saveGoogleDriveEmail(email);
                await settingsStore.saveGoogleDriveEnabled(true);
                autoSync.value = true;
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Sign in failed';
            } finally {
                signingIn.value = false;
            }
        }

        async function handleSignOut() {
            signingOut.value = true;
            try {
                await googleDriveProvider.signOut();
                syncService.updateAuthState();
                await settingsStore.saveGoogleDriveEnabled(false);
                await settingsStore.saveGoogleDriveEmail('');
                autoSync.value = false;
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Sign out failed';
            } finally {
                signingOut.value = false;
            }
        }

        async function handleSyncNow() {
            await syncService.pushAll(
                () => chatStore.sessions,
                (sessionId: string) => {
                    if (sessionId === chatStore.currentSessionId) {
                        return chatStore.messages;
                    }
                    return [];
                },
                () => settingsStore.userFacts,
                () => '0.2.6',
            );
        }

        async function onAutoSyncChange(val: boolean) {
            await settingsStore.saveGoogleDriveEnabled(val);
            if (val && googleDriveProvider.isSignedIn) {
                await handleSyncNow();
            }
        }

        async function handlePull() {
            confirmPull.value = false;
            try {
                await syncService.pullAll(
                    () => chatStore.sessions,
                    (sessionId: string) => {
                        if (sessionId === chatStore.currentSessionId) {
                            return chatStore.messages;
                        }
                        return [];
                    },
                    (sessions) => {
                        // Reload sessions in chatStore
                        chatStore.sessions.splice(0, chatStore.sessions.length, ...sessions);
                    },
                    (sessionId, messages) => {
                        // Store messages for the session
                        // For now, if it's the current session, update messages
                        if (sessionId === chatStore.currentSessionId) {
                            chatStore.messages.splice(0, chatStore.messages.length, ...messages);
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
            isSignedIn,
            userEmail,
            isSyncing,
            lastSyncAt,
            syncError,
            signingIn,
            signingOut,
            confirmPull,
            autoSync,
            formatTime,
            handleSignIn,
            handleSignOut,
            onAutoSyncChange,
            handleSyncNow,
            handlePull,
        };
    },
});
</script>
