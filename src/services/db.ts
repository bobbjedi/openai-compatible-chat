import { openDB, type IDBPDatabase } from 'idb';

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  summary?: string;
  summaryEnabled?: boolean;
}

export interface Message {
  id?: number;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'searchResult';
  content: string;
  reasoning?: string;
  searchMeta?: {
    query: string;
    resultsCount: number;
  };
  createdAt: number;
}

export interface Settings {
  key: string;
  value: string;
}

const DB_NAME = 'deepseek-chat';
const DB_VERSION = 2;

let dbInstance: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionStore.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', {
          keyPath: 'id',
          autoIncrement: true,
        });
        msgStore.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    },
  });

  return dbInstance;
}

// --- Sessions ---

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const raw = await db.getAll('sessions');
  return (raw as Session[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await getDb();
  return db.get('sessions', id) as Promise<Session | undefined>;
}

export async function putSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put('sessions', session);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sessions', 'messages'], 'readwrite');
  const index = tx.objectStore('messages').index('sessionId');
  const keys = await index.getAllKeys();
  const store = tx.objectStore('messages');
  keys.forEach((key) => {
    void store.delete(key);
  });
  void tx.objectStore('sessions').delete(id);
  await tx.done;
}

// --- Messages ---

export async function getMessages(sessionId: string): Promise<Message[]> {
  const db = await getDb();
  const index = db.transaction('messages').store.index('sessionId');
  const raw = await index.getAll(sessionId);
  return (raw as Message[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(msg: Message): Promise<number> {
  const db = await getDb();
  return db.put('messages', msg) as Promise<number>;
}

export async function deleteMessage(id: number): Promise<void> {
  const db = await getDb();
  await db.delete('messages', id);
}

// --- Settings ---

export async function getSetting(key: string): Promise<string | undefined> {
  const db = await getDb();
  const entry = (await db.get('settings', key)) as Settings | undefined;
  return entry?.value;
}

export async function putSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key, value });
}
