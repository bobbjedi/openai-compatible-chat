<template>
    <div class="session-list">
        <div class="session-list-header row items-center justify-between q-pa-sm">
            <div class="text-subtitle2 text-grey-7">Сессии</div>
            <q-btn flat dense round icon="add" color="primary" @click="store.createSession()">
                <q-tooltip>Новый чат</q-tooltip>
            </q-btn>
        </div>

        <q-list separator>
            <q-item v-for="s in store.sessions" :key="s.id" clickable v-ripple :active="s.id === store.currentSessionId"
                active-class="bg-primary text-white" @click="store.selectSession(s.id)">
                <q-item-section>
                    <q-item-label lines="1">{{ s.title }}</q-item-label>
                    <q-item-label caption :lines="1">
                        {{ formatDate(s.updatedAt) }}
                    </q-item-label>
                </q-item-section>
                <q-item-section side>
                    <q-btn flat dense round size="sm" icon="more_vert" @click.stop>
                        <q-menu auto-close anchor="bottom end" self="top end">
                            <q-list dense>
                                <q-item clickable @click="startRename(s)">
                                    <q-item-section>Переименовать</q-item-section>
                                </q-item>
                                <q-item clickable @click="store.removeSession(s.id)">
                                    <q-item-section class="text-negative">Удалить</q-item-section>
                                </q-item>
                            </q-list>
                        </q-menu>
                    </q-btn>
                </q-item-section>
            </q-item>
        </q-list>

        <q-dialog v-model="renameDialog" persistent>
            <q-card style="min-width: 300px">
                <q-card-section class="row items-center q-pb-none">
                    <div class="text-h6">Переименовать сессию</div>
                    <q-space />
                    <q-btn flat round dense icon="close" v-close-popup />
                </q-card-section>
                <q-card-section>
                    <q-input v-model="renameTitle" dense outlined autofocus @keydown.enter.prevent="confirmRename" />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Отмена" v-close-popup />
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

        function formatDate(ts: number): string {
            return new Date(ts).toLocaleString();
        }

        function startRename(s: Session) {
            renameId.value = s.id;
            renameTitle.value = s.title;
            renameDialog.value = true;
        }

        async function confirmRename() {
            if (renameId.value && renameTitle.value.trim()) {
                await store.renameSession(renameId.value, renameTitle.value.trim());
            }
            renameDialog.value = false;
        }

        return {
            store,
            renameDialog,
            renameTitle,
            formatDate,
            startRename,
            confirmRename,
        };
    },
});
</script>

<style scoped>
.session-list-header {
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
    min-height: 48px;
}
</style>
