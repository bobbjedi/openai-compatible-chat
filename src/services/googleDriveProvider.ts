/**
 * Google Drive Sync Provider
 *
 * Использует Google Identity Services (GIS) для OAuth 2.0.
 * Работает с Google Drive API v3 через fetch.
 *
 * Scope: https://www.googleapis.com/auth/drive.file
 *   — приложение видит только свои файлы
 *
 * Токен хранится в sessionStorage (очищается при закрытии вкладки).
 *
 * ## Настройка Google Cloud Console:
 * 1. Создать проект → APIs & Services → Library → Enable Google Drive API
 * 2. Credentials → Create OAuth client ID → Web application
 * 3. Authorized JavaScript origins: http://localhost:8080 (dev)
 * 4. Скопировать Client ID → вставить в CLIENT_ID ниже
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

// ⚠️ ЗАМЕНИТЕ НА ВАШ CLIENT ID ИЗ GOOGLE CLOUD CONSOLE
const CLIENT_ID = '235586934435-fvmthpmg1hov1air218j93utoihft2t1.apps.googleusercontent.com';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const BACKUP_FOLDER_NAME = 'OpenAI-Chat-Backup';
const API_BASE = 'https://www.googleapis.com/drive/v3';

// --- Типы ---

export interface DriveManifest {
  version: number;
  appVersion: string;
  lastSyncedAt: number;
  sessionsCount: number;
  totalMessages: number;
}

export interface DriveSessionData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  systemPrompt?: string;
  summary?: string;
  summaryEnabled?: boolean;
}

export interface DriveMessageData {
  id?: number;
  uuid: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'searchResult';
  content: string;
  reasoning?: string;
  searchMeta?: {
    query: string;
    resultsCount: number;
  };
  attachments?: Array<{
    name: string;
    type: string;
    size: number;
  }>;
  createdAt: number;
}

export interface DriveUserFacts {
  facts: string[];
  updatedAt: number;
}

// --- Состояние авторизации ---

interface AuthState {
  accessToken: string;
  expiresAt: number;
}

let authState: AuthState | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenClient: any = null;

// --- Вспомогательные функции ---

function loadGsiScript(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as unknown as Record<string, unknown>).google) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

function getTokenFromStorage(): AuthState | null {
  try {
    const raw = sessionStorage.getItem('google-drive-token');
    if (!raw) return null;
    const parsed: AuthState = JSON.parse(raw);
    if (parsed.expiresAt > Date.now()) {
      return parsed;
    }
    sessionStorage.removeItem('google-drive-token');
    return null;
  } catch {
    return null;
  }
}

function saveTokenToStorage(token: AuthState): void {
  try {
    sessionStorage.setItem('google-drive-token', JSON.stringify(token));
  } catch {
    // sessionStorage unavailable
  }
}

function clearTokenFromStorage(): void {
  try {
    sessionStorage.removeItem('google-drive-token');
  } catch {
    // ignore
  }
}

function getAccessToken(): string | null {
  if (authState && authState.expiresAt > Date.now()) {
    return authState.accessToken;
  }
  const stored = getTokenFromStorage();
  if (stored) {
    authState = stored;
    return stored.accessToken;
  }
  return null;
}

// --- Google Drive API calls ---

async function driveFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in with Google.');
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    authState = null;
    clearTokenFromStorage();
    throw new Error('Google Drive token expired. Please sign in again.');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Drive API error ${res.status}: ${body}`);
  }

  return res;
}

/**
 * Find a file by name in a specific folder (or root).
 * Returns file ID or null.
 */
async function findFile(
  fileName: string,
  parentId?: string,
): Promise<string | null> {
  let query = `name='${fileName}' and trashed=false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const res = await driveFetch(
    `/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10`,
  );
  const data: { files?: Array<{ id: string; name: string }> } = await res.json();
  const files = data.files || [];
  return files.length > 0 ? files[0].id : null;
}

/**
 * Ensure the backup folder exists. Returns folder ID.
 */
async function ensureBackupFolder(): Promise<string> {
  const existingId = await findFile(BACKUP_FOLDER_NAME);
  if (existingId) return existingId;

  const res = await driveFetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const data: { id: string } = await res.json();
  return data.id;
}

/**
 * Read a file's content as text. Returns null if file doesn't exist.
 */
async function readFile(fileName: string): Promise<string | null> {
  const folderId = await ensureBackupFolder();
  const fileId = await findFile(fileName, folderId);
  if (!fileId) return null;

  try {
    const res = await driveFetch(`/files/${fileId}?alt=media`);
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Write content to a file. Creates if doesn't exist, updates if exists.
 */
async function writeFile(fileName: string, content: string): Promise<void> {
  const folderId = await ensureBackupFolder();
  const existingId = await findFile(fileName, folderId);

  if (existingId) {
    // Update existing file — use /upload/ endpoint for media upload
    const url = `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`;
    await driveFetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: content,
    });
  } else {
    // Create new file — POST with metadata
    const createRes = await driveFetch('/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    });
    const createData = await createRes.json() as Record<string, unknown>;
    const newId = createData.id as string | undefined;

    if (newId) {
      // Update content via /upload/ endpoint
      const url = `https://www.googleapis.com/upload/drive/v3/files/${newId}?uploadType=media`;
      await driveFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: content,
      });
    }
  }
}

/**
 * Delete a file by name from the backup folder.
 */
async function deleteFile(fileName: string): Promise<void> {
  const folderId = await ensureBackupFolder();
  const fileId = await findFile(fileName, folderId);
  if (!fileId) return;

  await driveFetch(`/files/${fileId}`, { method: 'DELETE' });
}

// --- Публичное API ---

export const googleDriveProvider = {
  /**
   * Инициализировать GIS и запросить токен.
   * Вызывает браузерный попап Google для авторизации.
   */
  async signIn(): Promise<{ email: string }> {
    await loadGsiScript();

    return new Promise<{ email: string }>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const gsi: any = (window as unknown as Record<string, unknown>).google;
      if (!gsi?.accounts?.oauth2) {
        reject(new Error('Google Identity Services failed to load'));
        return;
      }

      if (!tokenClient) {
        tokenClient = gsi.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (response: Record<string, string>) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error));
              return;
            }
            const expiresIn = parseInt(response.expires_in || '3600', 10);
            authState = {
              accessToken: response.access_token,
              expiresAt: Date.now() + expiresIn * 1000,
            };
            saveTokenToStorage(authState);

            this.getUserEmail()
              .then((email) => resolve({ email }))
              .catch(() => resolve({ email: 'Unknown' }));
          },
          error_callback: (error: { message: string }) => {
            reject(new Error(error.message || 'Google sign-in failed'));
          },
        });
      }

      tokenClient.requestAccessToken();
    });
  },

  /**
   * Выйти из аккаунта Google.
   */
  async signOut(): Promise<void> {
    const token = getAccessToken();
    if (token) {
      try {
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${token}`,
          { method: 'POST' },
        );
      } catch {
        // ignore revoke errors
      }
    }
    authState = null;
    clearTokenFromStorage();
    tokenClient = null;
  },

  /**
   * Проверить, авторизован ли пользователь.
   */
  get isSignedIn(): boolean {
    return getAccessToken() !== null;
  },

  /**
   * Получить email пользователя через Google People API или tokeninfo.
   */
  async getUserEmail(): Promise<string> {
    try {
      const res = await driveFetch(
        'https://www.googleapis.com/oauth2/v2/userinfo?fields=email',
      );
      const data: { email?: string } = await res.json();
      return data.email || 'Unknown';
    } catch {
      return 'Unknown';
    }
  },

  // --- Чтение ---

  async readManifest(): Promise<DriveManifest | null> {
    const raw = await readFile('manifest.json');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DriveManifest;
    } catch {
      return null;
    }
  },

  async readSessions(): Promise<DriveSessionData[] | null> {
    const raw = await readFile('sessions.json');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DriveSessionData[];
    } catch {
      return null;
    }
  },

  async readSessionMessages(
    sessionId: string,
  ): Promise<DriveMessageData[] | null> {
    const raw = await readFile(`sessions/${sessionId}.json`);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { sessionId: string; messages: DriveMessageData[] };
      return data.messages;
    } catch {
      return null;
    }
  },

  async readUserFacts(): Promise<DriveUserFacts | null> {
    const raw = await readFile('user-facts.json');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DriveUserFacts;
    } catch {
      return null;
    }
  },

  // --- Запись ---

  async writeManifest(manifest: DriveManifest): Promise<void> {
    await writeFile('manifest.json', JSON.stringify(manifest, null, 2));
  },

  async writeSessions(sessions: DriveSessionData[]): Promise<void> {
    await writeFile('sessions.json', JSON.stringify(sessions, null, 2));
  },

  async writeSessionMessages(
    sessionId: string,
    messages: DriveMessageData[],
  ): Promise<void> {
    const data = { sessionId, messages };
    await writeFile(
      `sessions/${sessionId}.json`,
      JSON.stringify(data, null, 2),
    );
  },

  async writeUserFacts(facts: DriveUserFacts): Promise<void> {
    await writeFile('user-facts.json', JSON.stringify(facts, null, 2));
  },

  async deleteSessionFile(sessionId: string): Promise<void> {
    await deleteFile(`sessions/${sessionId}.json`);
  },

  async checkBackupExists(): Promise<boolean> {
    const manifest = await this.readManifest();
    return manifest !== null;
  },
};
