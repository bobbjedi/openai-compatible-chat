<template>
    <div class="chatgpt-sessions">
        <!-- New chat button -->
        <div class="q-pa-sm">
            <q-btn no-caps class="chatgpt-new-btn full-width" @click="store.createSession()">
                <q-icon name="add" size="xs" class="q-mr-sm" />
                <span>New chat</span>
            </q-btn>
        </div>

        <!-- Session list -->
        <q-scroll-area class="chatgpt-sessions-scroll">
            <q-list dense>
                <q-item v-for="s in store.sessions" :key="s.id" clickable v-ripple
                    :active="s.id === store.currentSessionId" active-class="chatgpt-session--active"
                    class="chatgpt-session q-mx-xs" @click="store.selectSession(s.id)">
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
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useChatStore, type Session } from 'src/stores/chatStore';

export default defineComponent({
    name: 'SessionList',
    setup() {
        const store = useChatStore();
        const renameDialog = ref(false);
        const renameId = ref<string | null>(null);
        const renameTitle = ref('');

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

        return {
            store,
            renameDialog,
            renameTitle,
            startRename,
            confirmRename,
        };
    },
});
</script>
