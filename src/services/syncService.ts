/**
 * Sync Service — оркестратор синхронизации с Google Drive.
 *
 * Координирует push (локальное → Drive) и pull (Drive → локальное).
 * Использует debounce для группировки изменений.
 */

import { ref, type Ref } from 'vue';
import {
  googleDriveProvider,
  type DriveSessionData,
  type DriveMessageData,
  type DriveUserFacts,
} from './googleDriveProvider';
import type { Session, Message } from './db';
import {
  putSession, putMessage, deleteMessagesBySession, deleteSession,
} from './db';

// --- Состояние синхронизации ---

export const syncState = {
  isSyncing: ref(false) as Ref<boolean>,
  lastSyncAt: ref<number | null>(null),
  syncError: ref<string | null>(null),
  isSignedIn: ref(false) as Ref<boolean>,
  userEmail: ref(''),
};

// --- Debounce queue ---

const syncQueue = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function flushSync(
  getSessions: () => Session[],
  getMessages: (id: string) => Message[],
  getUserFacts: () => string[],
  getAppVersion: () => string,
): Promise<void> {
  if (!googleDriveProvider.isSignedIn) return;

  const sessionIds = Array.from(syncQueue);
  syncQueue.clear();

  syncState.isSyncing.value = true;
  syncState.syncError.value = null;

  try {
    // Push changed sessions in parallel
    await Promise.all(
      sessionIds.map(async (sid) => {
        const messages = getMessages(sid);
        if (messages.length > 0) {
          const driveMessages: DriveMessageData[] = messages.map((m) => ({
            id: m.id,
            uuid: m.uuid,
            sessionId: m.sessionId,
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            searchMeta: m.searchMeta,
            attachments: m.attachments,
            createdAt: m.createdAt,
          }));
          await googleDriveProvider.writeSessionMessages(sid, driveMessages);
        }
      }),
    );

    // Push sessions list
    const allSessions = getSessions();
    const driveSessions: DriveSessionData[] = allSessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      systemPrompt: s.systemPrompt,
      summary: s.summary,
      summaryEnabled: s.summaryEnabled,
    }));
    await googleDriveProvider.writeSessions(driveSessions);

    // Push user facts
    const facts = getUserFacts();
    const factsData: DriveUserFacts = {
      facts,
      updatedAt: Date.now(),
    };
    await googleDriveProvider.writeUserFacts(factsData);

    // Push manifest
    const totalMessages = allSessions.reduce((acc, s) => (
      acc + getMessages(s.id).length
    ), 0);
    await googleDriveProvider.writeManifest({
      version: 1,
      appVersion: getAppVersion(),
      lastSyncedAt: Date.now(),
      sessionsCount: allSessions.length,
      totalMessages,
    });

    syncState.lastSyncAt.value = Date.now();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    syncState.syncError.value = msg;
    // eslint-disable-next-line no-console
    console.warn('[sync] Error:', msg);
  } finally {
    syncState.isSyncing.value = false;
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function scheduleFlush(
  getSessions: () => Session[],
  getMessages: (id: string) => Message[],
  getUserFacts: () => string[],
  getAppVersion: () => string,
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void flushSync(getSessions, getMessages, getUserFacts, getAppVersion);
  }, 2000);
}

// --- Публичное API ---

export const syncService = {
  /**
   * Поставить сессию в очередь на синхронизацию.
   * Вызовет push через 2 секунды после последнего изменения.
   */
  enqueueSync(sessionId: string): void {
    if (!googleDriveProvider.isSignedIn) return;
    syncQueue.add(sessionId);
  },

  /**
   * Push только одной сессии в Drive.
   */
  async pushSession(
    sessionId: string,
    getMessages: (id: string) => Message[],
    getSessions: () => Session[],
    getUserFacts: () => string[],
    getAppVersion: () => string,
  ): Promise<void> {
    if (!googleDriveProvider.isSignedIn) {
      throw new Error('Not signed in to Google Drive');
    }

    syncState.isSyncing.value = true;
    syncState.syncError.value = null;

    try {
      const messages = getMessages(sessionId);
      if (messages.length > 0) {
        const driveMessages: DriveMessageData[] = messages.map((m) => ({
          id: m.id,
          uuid: m.uuid,
          sessionId: m.sessionId,
          role: m.role,
          content: m.content,
          reasoning: m.reasoning,
          searchMeta: m.searchMeta,
          attachments: m.attachments,
          createdAt: m.createdAt,
        }));
        await googleDriveProvider.writeSessionMessages(sessionId, driveMessages);
      }

      // Push sessions list
      const allSessions = getSessions();
      const driveSessions: DriveSessionData[] = allSessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        systemPrompt: s.systemPrompt,
        summary: s.summary,
        summaryEnabled: s.summaryEnabled,
      }));
      await googleDriveProvider.writeSessions(driveSessions);

      // Push user facts
      const facts = getUserFacts();
      const factsData: DriveUserFacts = { facts, updatedAt: Date.now() };
      await googleDriveProvider.writeUserFacts(factsData);

      // Push manifest
      const totalMessages = allSessions.reduce((acc, s) => (
        acc + getMessages(s.id).length
      ), 0);
      await googleDriveProvider.writeManifest({
        version: 1,
        appVersion: getAppVersion(),
        lastSyncedAt: Date.now(),
        sessionsCount: allSessions.length,
        totalMessages,
      });

      syncState.lastSyncAt.value = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      syncState.syncError.value = msg;
      throw err;
    } finally {
      syncState.isSyncing.value = false;
    }
  },

  /**
   * Полный push всех данных в Drive.
   */
  async pushAll(
    getSessions: () => Session[],
    getMessages: (id: string) => Message[],
    getUserFacts: () => string[],
    getAppVersion: () => string,
  ): Promise<void> {
    const allSessions = getSessions();
    allSessions.forEach((session) => {
      syncQueue.add(session.id);
    });
    await flushSync(getSessions, getMessages, getUserFacts, getAppVersion);
  },

  /**
   * Pull всех данных из Drive — полная замена локальных данных.
   * Удаляет локальные сессии/сообщения и записывает версию с Drive.
   */
  async pullAll(
    getLocalSessions: () => Session[],
    getLocalMessages: (sid: string) => Message[],
    setSessions: (s: Session[]) => void,
    setMessages: (sid: string, msgs: Message[]) => void,
    setUserFacts: (f: string[]) => void,
  ): Promise<{ sessionsCount: number; messagesCount: number }> {
    if (!googleDriveProvider.isSignedIn) {
      throw new Error('Not signed in to Google Drive');
    }

    syncState.isSyncing.value = true;
    syncState.syncError.value = null;

    try {
      const driveSessions = await googleDriveProvider.readSessions();
      if (!driveSessions) {
        throw new Error('No backup found in Google Drive');
      }

      const driveSessionIds = new Set(driveSessions.map((ds) => ds.id));

      // Delete local sessions that exist on Drive (will be fully replaced)
      const localSessions = getLocalSessions();
      await Promise.all(
        localSessions
          .filter((s) => driveSessionIds.has(s.id))
          .map((s) => deleteSession(s.id)),
      );

      // Map Drive → local Session type
      const sessions: Session[] = driveSessions
        .map((ds) => ({
          id: ds.id,
          title: ds.title,
          createdAt: ds.createdAt,
          updatedAt: ds.updatedAt,
          systemPrompt: ds.systemPrompt,
          summary: ds.summary,
          summaryEnabled: ds.summaryEnabled,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);

      await Promise.all(sessions.map((s) => putSession({ ...s })));

      // Pull messages for each session in parallel
      const messagesResults = await Promise.all(
        sessions.map(async (session) => {
          const driveMessages = await googleDriveProvider
            .readSessionMessages(session.id);
          if (!driveMessages || driveMessages.length === 0) {
            return { sessionId: session.id, messages: [] as Message[] };
          }

          const msgs: Message[] = driveMessages
            .map((dm) => ({
              id: dm.id,
              uuid: dm.uuid || crypto.randomUUID(),
              sessionId: dm.sessionId,
              role: dm.role,
              content: dm.content,
              reasoning: dm.reasoning,
              searchMeta: dm.searchMeta,
              attachments: dm.attachments,
              createdAt: dm.createdAt,
            }))
            .sort((a, b) => a.createdAt - b.createdAt);

          await deleteMessagesBySession(session.id);
          await Promise.all(msgs.map((m) => putMessage({ ...m })));

          return { sessionId: session.id, messages: msgs };
        }),
      );

      const totalMessages = messagesResults.reduce(
        (acc, r) => acc + r.messages.length, 0,
      );

      // Apply to UI
      messagesResults.forEach(
        ({ sessionId, messages }) => setMessages(sessionId, messages),
      );
      setSessions(sessions);

      const driveFacts = await googleDriveProvider.readUserFacts();
      if (driveFacts) setUserFacts(driveFacts.facts);

      syncState.lastSyncAt.value = Date.now();

      return { sessionsCount: sessions.length, messagesCount: totalMessages };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pull failed';
      syncState.syncError.value = msg;
      throw err;
    } finally {
      syncState.isSyncing.value = false;
    }
  },

  /**
   * Удалить файл сессии из Drive.
   */
  async deleteSessionFile(sessionId: string): Promise<void> {
    if (!googleDriveProvider.isSignedIn) return;
    try {
      await googleDriveProvider.deleteSessionFile(sessionId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sync] Error deleting session file:', err);
    }
  },

  /**
   * Обновить статус авторизации.
   */
  updateAuthState(): void {
    syncState.isSignedIn.value = googleDriveProvider.isSignedIn;
    if (googleDriveProvider.isSignedIn) {
      googleDriveProvider.getUserEmail()
        .then((email) => {
          syncState.userEmail.value = email;
        })
        .catch(() => {
          syncState.userEmail.value = 'Unknown';
        });
    } else {
      syncState.userEmail.value = '';
    }
  },
};
