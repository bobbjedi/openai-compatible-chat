<template>
    <q-dialog v-model="visible" persistent>
        <q-card class="chatgpt-dialog" style="width: 440px">
            <q-card-section class="row items-center q-pb-sm">
                <div class="text-h6">Chat Settings</div>
                <q-space />
                <q-btn flat round dense icon="close" v-close-popup />
            </q-card-section>

            <q-card-section class="q-px-md q-gutter-sm q-pt-none">
                <!-- Auto-summary toggle -->
                <div class="row items-center q-mb-sm">
                    <div>
                        <div class="text-subtitle2 text-grey-8">Auto Summary</div>
                        <div class="text-caption text-grey-6">Preserves context of long conversations via periodic
                            summarization</div>
                    </div>
                    <q-space />
                    <q-toggle v-model="localSummaryEnabled" color="primary" />
                </div>

                <q-separator spaced />

                <!-- System prompt — сворачивается если не в фокусе и есть текст -->
                <div class="text-subtitle2 text-grey-8 q-mb-xs">System Prompt</div>
                <q-input v-model="localPrompt" type="textarea" outlined dense :autogrow="promptFocused"
                    :rows="promptFocused ? 4 : 1"
                    placeholder="Enter system instructions (e.g. «You are a helpful assistant, answer concisely»)."
                    hint="Sent as a system message at the beginning of each request." :rules="[]" :maxlength="10000"
                    counter @focus="promptFocused = true" @blur="promptFocused = false" />

                <!-- Load from file -->
                <div class="row items-center q-col-gutter-sm">
                    <div class="col">
                        <q-file v-model="file" outlined dense label="Load from file (.txt)" accept=".txt,text/plain"
                            max-file-size="1048576" @update:model-value="onFileSelected" clearable>
                            <template v-slot:prepend>
                                <q-icon name="attach_file" />
                            </template>
                        </q-file>
                    </div>
                </div>
                <!-- Google Drive Sync for this chat -->
                <q-separator spaced />
                <div class="text-subtitle2 text-grey-8 q-mb-xs">Google Drive Sync</div>
                <template v-if="syncState.isSignedIn">
                    <div class="row q-gutter-sm">
                        <q-btn outline dense size="sm" color="primary" icon="cloud_upload" label="Sync this chat"
                            :loading="syncingChat" :disable="!store.currentSessionId" @click="syncCurrentChat" />
                        <q-btn outline dense size="sm" color="warning" icon="cloud_download" label="Load this chat"
                            :loading="loadingChat" :disable="!store.currentSessionId" @click="loadCurrentChat" />
                    </div>
                    <div v-if="lastSyncTime" class="text-caption text-grey-6 q-mt-xs">
                        Last sync: {{ lastSyncTime }}
                    </div>
                </template>
                <template v-else>
                    <p class="text-caption text-grey-6 q-mb-sm">
                        Sign in to Google Drive to sync this chat across devices.
                    </p>
                    <q-btn outline dense size="sm" color="primary" icon="cloud_upload" label="Sign in with Google"
                        :loading="signingIn" @click="handleSignIn" />
                </template>
            </q-card-section>

            <q-card-actions align="right" class="q-gutter-sm">
                <q-btn flat label="Cancel" color="grey" v-close-popup />
                <q-btn flat label="Save" color="primary" @click="saveAndClose" />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script lang="ts">
import {
    defineComponent, ref, watch, computed,
} from 'vue';
import { useChatStore } from 'src/stores/chatStore';
import { useSettingsStore } from 'src/stores/settingsStore';
import { syncService, syncState } from 'src/services/syncService';
import { googleDriveProvider } from 'src/services/googleDriveProvider';

export default defineComponent({
    name: 'ChatSettingsDialog',
    props: {
        modelValue: { type: Boolean, default: false },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const store = useChatStore();
        const settingsStore = useSettingsStore();

        const visible = computed({
            get: () => props.modelValue,
            set: (val) => emit('update:modelValue', val),
        });

        const localPrompt = ref('');
        const localSummaryEnabled = ref(false);
        const file = ref<File | null>(null);
        const syncingChat = ref(false);
        const loadingChat = ref(false);
        const signingIn = ref(false);
        const promptFocused = ref(false);

        const lastSyncTime = computed(() => {
            const ts = syncState.lastSyncAt.value;
            if (!ts) return null;
            const diff = Date.now() - ts;
            if (diff < 60000) return 'just now';
            if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
            return new Date(ts).toLocaleDateString();
        });

        // When dialog opens, populate with current values from active session
        watch(visible, (isOpen) => {
            if (isOpen) {
                localPrompt.value = store.currentSession?.systemPrompt ?? '';
                localSummaryEnabled.value = store.currentSession?.summaryEnabled ?? false;
                file.value = null;
            }
        });

        async function onFileSelected(f: File | null) {
            if (!f) return;
            try {
                const text = await f.text();
                localPrompt.value = text.slice(0, 10000);
                file.value = f; // keep reference so q-file shows the name
            } catch {
                // Read error — ignore
            }
        }

        async function handleSignIn() {
            signingIn.value = true;
            try {
                const { email } = await googleDriveProvider.signIn();
                syncService.updateAuthState();
                await settingsStore.saveGoogleDriveEmail(email);
                await settingsStore.saveGoogleDriveEnabled(true);
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Sign in failed';
            } finally {
                signingIn.value = false;
            }
        }

        async function loadCurrentChat() {
            const sid = store.currentSessionId;
            if (!sid) return;
            loadingChat.value = true;
            try {
                const driveMessages = await googleDriveProvider.readSessionMessages(sid);
                if (driveMessages && driveMessages.length > 0) {
                    // Replace local messages with Drive messages
                    store.messages.splice(0, store.messages.length);
                    driveMessages.forEach((dm) => {
                        store.messages.push({
                            id: dm.id,
                            uuid: dm.uuid || crypto.randomUUID(),
                            sessionId: dm.sessionId,
                            role: dm.role,
                            content: dm.content,
                            reasoning: dm.reasoning,
                            searchMeta: dm.searchMeta,
                            attachments: dm.attachments,
                            createdAt: dm.createdAt,
                        });
                    });
                    syncState.lastSyncAt.value = Date.now();
                }
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Load failed';
            } finally {
                loadingChat.value = false;
            }
        }

        async function syncCurrentChat() {
            const sid = store.currentSessionId;
            if (!sid) return;
            syncingChat.value = true;
            try {
                await syncService.pushSession(
                    sid,
                    (sessionId: string) => {
                        if (sessionId === sid) {
                            return store.messages;
                        }
                        return [];
                    },
                    () => store.sessions,
                    () => settingsStore.userFacts,
                    () => '0.2.6',
                );
            } catch (err) {
                syncState.syncError.value = err instanceof Error ? err.message : 'Sync failed';
            } finally {
                syncingChat.value = false;
            }
        }

        async function saveAndClose() {
            const prompt = localPrompt.value.trim();
            await store.updateSystemPrompt(prompt || undefined);
            await store.updateSummaryEnabled(localSummaryEnabled.value);
            emit('update:modelValue', false);
        }

        return {
            store,
            visible,
            localPrompt,
            localSummaryEnabled,
            file,
            syncingChat,
            loadingChat,
            signingIn,
            loadCurrentChat,
            syncState,
            lastSyncTime,
            promptFocused,
            handleSignIn,
            syncCurrentChat,
            onFileSelected,
            saveAndClose,
        };
    },
});
</script>
