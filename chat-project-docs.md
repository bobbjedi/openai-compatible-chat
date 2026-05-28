# ChatLLM-подобное чат-приложение на Quasar (Vue 3 + TypeScript)

> Полная документация по реализованному проекту

---

## 1. Технологический стек

| Слой | Технология | Версия |
|------|-----------|--------|
| Фреймворк | Quasar (SPA, webpack) | 2.14.0 |
| CLI | @quasar/app | 3.3.3 |
| UI-библиотека | Vue 3 (Composition API) | ^3.0.0 |
| Язык | TypeScript | 4.5.5 |
| Стейт-менеджмент | Pinia | 2 |
| Локальное хранилище | IndexedDB (через `idb`) | 8.0.3 |
| Маркдаун | marked + DOMPurify | 11 / 3.4.5 |
| Стилизация | Sass (SCSS) | 1.77.8 |
| Роутинг | Vue Router | ^4.0.0 |
| Синхронизация | Google Drive API v3 (GIS OAuth 2.0) | — |
| Поиск | Tavily Search API | — |
| PWA | workbox-precaching (InjectManifest) | — |
| Голос | Web Speech API (SpeechRecognition + SpeechSynthesis) | — |
| Распознавание языка | `navigator.languages` → `Intl.DateTimeFormat` → `navigator.language` | — |

---

## 2. Структура проекта

```
src/
├── components/
│   ├── ChatInput.vue            # Поле ввода с файловыми чипами и голосовым вводом
│   ├── SessionList.vue          # Список сессий в боковой панели
│   ├── SettingsDialog.vue       # Диалог глобальных настроек (API, Vision, Search, Sync, Summary)
│   ├── ChatSettingsDialog.vue   # Диалог настроек чата (system prompt, auto summary toggle)
│   ├── SyncSettings.vue         # UI Google Drive синхронизации (внутри SettingsDialog)
│   └── StepVoiceOverlay.vue     # Полноэкранный оверлей Step Voice Mode
├── css/
│   ├── app.scss                 # Глобальные стили (светлая + тёмная тема)
│   └── quasar.variables.scss    # Переменные Quasar
├── layouts/
│   └── MainLayout.vue           # Корневой layout с header (TTS, Step Voice, User Facts, Chat Settings), sidebar и StepVoiceOverlay
├── pages/
│   ├── ChatPage.vue             # Страница чата (сообщения, welcome, streaming, edit, copy, file chips, facts banner)
│   ├── Error404.vue             # 404 страница
│   ├── Index.vue                # Редирект на чат
│   └── VoiceDebugPage.vue       # Страница отладки голосового ввода
├── router/
│   ├── index.ts                 # Конфигурация роутера
│   └── routes.ts                # Определения маршрутов
├── services/
│   ├── db.ts                    # Слой работы с IndexedDB (сессии, сообщения, настройки)
│   ├── llmProvider.ts           # OpenAI-совместимый SSE-стриминговый клиент
│   ├── fileParser.ts            # Парсер файлов (текст + изображения в base64)
│   ├── googleDriveProvider.ts   # Google Drive API клиент (OAuth, CRUD файлов)
│   ├── searchProvider.ts        # Tavily Search API клиент
│   ├── speechRecognition.ts     # Обёртка Web Speech API (с десктоп/мобайл адаптацией)
│   ├── stepVoiceService.ts      # Сервис Step-by-Step Voice Mode (состояния, бипы, TTS)
│   ├── syncService.ts           # Оркестратор синхронизации с Google Drive (debounce, push/pull)
│   └── ttsSanitizer.ts          # Санитизация текста для SpeechSynthesis
├── stores/
│   ├── chatStore.ts             # Pinia-стор чата (сессии, сообщения, стриминг, tool loop, файлы, search, summary, facts)
│   └── settingsStore.ts         # Pinia-стор настроек (endpoint, apiKey, model, vision, search, sync, TTS, voice)
└── types/
    └── gsi.d.ts                 # Типы для Google Identity Services
src-pwa/
├── custom-service-worker.js     # Service worker (workbox InjectManifest)
├── pwa-flag.d.ts               # Флаг PWA режима
└── register-service-worker.js   # Регистрация service worker
plans/
├── file-attachments.md          # План: прикрепление файлов
├── google-drive-sync.md         # План: синхронизация с Google Drive
├── step-voice-mode.md           # План: Step-by-Step Voice Mode
└── voice-beeps.md               # План: звуковые сигналы для Voice Mode
```

---

## 3. Схема IndexedDB

База данных: `deepseek-chat` (версия 2)

### Object Store: `sessions`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` (keyPath) | `string` | UUID сессии |
| `title` | `string` | Название чата |
| `createdAt` | `number` | Timestamp создания |
| `updatedAt` | `number` | Timestamp последнего обновления |
| `systemPrompt` | `string` (опционально) | Системный промпт (инструкция) для чата |
| `summary` | `string` (опционально) | Краткое содержание диалога (rolling summary) |
| `summaryEnabled` | `boolean` (опционально) | Включено ли авто-саммари для чата |

Индекс: `updatedAt`

### Object Store: `messages`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` (keyPath, autoIncrement) | `number` | Авто-инкрементный ID |
| `uuid` | `string` | Глобально-уникальный ID для кросс-устройственной синхронизации |
| `sessionId` | `string` | Внешний ключ на сессию |
| `role` | `'user' \| 'assistant' \| 'system' \| 'searchResult'` | Роль отправителя |
| `content` | `string` | Текст сообщения |
| `reasoning` | `string` (опционально) | Цепочка рассуждений (DeepSeek R1) |
| `searchMeta` | `{ query: string; resultsCount: number }` (опционально) | Метаданные поиска для assistant-сообщений |
| `attachments` | `AttachmentMeta[]` (опционально) | Метаданные прикреплённых файлов |
| `createdAt` | `number` | Timestamp создания |

Индекс: `sessionId`

### Object Store: `settings`

| Поле | Тип | Описание |
|------|-----|----------|
| `key` (keyPath) | `string` | Ключ настройки |
| `value` | `string` | Значение (всегда строка) |

Ключи: `endpoint`, `apiKey`, `model`, `summaryModel`, `tokenLimit`, `userFacts`, `searchApiKey`, `searchEnabled`, `visionEnabled`, `visionModel`, `googleDriveEnabled`, `googleDriveEmail`, `ttsRate`, `stepVoiceTimeout`

> **Примечание**: `darkMode` вынесен из IndexedDB в `localStorage` для синхронного доступа (избежание мигания темы при загрузке).

---

## 4. Поток данных

```
User Input (ChatInput.vue)
  → chatStore.sendMessage(text, parsedFiles?)
    → Создание user-сообщения с attachments → putMessage() → IndexedDB
    → Авто-заголовок сессии (первое сообщение)
    → Создание пустого assistant-сообщения → putMessage() → IndexedDB
    → buildTrimmedMessages() — обрезка контекста по токенам
      → system prompt (если задан) всегда первым сообщением
      → User Facts — глобальная база знаний о пользователе
      → rolling summary (если есть) вставляется как system-контекст
      → user/assistant сообщения, пока укладываются в лимит токенов
      → searchResult маппится в 'user' роль для LLM
    → Если есть файлы — содержимое вставляется перед последним user-сообщением
    → Если есть изображения + visionEnabled — user-сообщение в vision-формате (image_url + text)
    → Формирование LlmMessage[] (system + user/assistant)
    → console.log полного payload для отладки
    → streamWithToolLoop() — цикл «LLM → tool call → search → LLM» (до 3 раундов)
      → streamChat() (llmProvider.ts)
        → fetch POST /chat/completions (SSE, stream: true)
        → ReadableStream → построчное чтение → JSON-парсинг чанков
        → onChunk(delta) → обновление content в messages[idx]
        → onReasoning(text) → обновление reasoning в messages[idx]
        → onDone() → проверка tool call (detectToolCall)
          → если tool call: searchWeb() → вставка searchResult → новый assistant → повтор
          → если нет: putMessage() в IndexedDB → maybeSummarize()
      → syncService.enqueueSync() — в очередь на синхронизацию
```

---

## 5. Компоненты

### [`ChatInput.vue`](src/components/ChatInput.vue)

Поле ввода в стиле ChatLLM: pill-форма (border-radius: 24px), autogrow, кнопка отправки (стрелка вверх) / остановки (stop).

- **Enter** — отправка сообщения (на десктопе; на мобильных Enter работает как перенос строки)
- **Shift+Enter** — перенос строки
- **Кнопка Stop** — отмена стриминга через `AbortController`
- **Отключено** во время стриминга
- **Disclaimer**: «LLMChat can make mistakes. Check important info.»
- **Прикрепление файлов** (кнопка 📎 в `#prepend` слоте):
  - `<input type="file" multiple hidden>` — выбор файлов
  - Чипы с именем, размером и превью (для изображений)
  - Кнопка удаления (×) на каждом чипе
  - При отправке: `parseFiles()` → `chatStore.sendMessage(text, parsedFiles)`
- **Голосовой ввод** (кнопка микрофона в `#append` слоте):
  - Использует [`speechRecognition.ts`](src/services/speechRecognition.ts) (Web Speech API)
  - Поддержка проверяется через `'SpeechRecognition' in window || 'webkitSpeechRecognition' in window`
  - Кнопка микрофона показывается только если API доступен
  - При активации: красная пульсирующая кнопка (CSS-анимация `pulse`), `recognition.start()`
  - **Непрерывный режим** на десктопе: авто-рестарт через `onEnd` пока `isListening === true`
  - **Определение языка**: цепочка из трёх источников:
    1. `navigator.languages` — упорядоченные предпочтения браузера
    2. `Intl.DateTimeFormat().resolvedOptions().locale` — локаль ОС
    3. `navigator.language` — язык интерфейса браузера
    - Если любой источник начинается с `ru` → `ru-RU`, иначе `en-US`

```typescript
// Ключевая логика
async function submit() {
  const val = text.value.trim();
  const hasFiles = pendingFiles.value.length > 0;
  if ((!val && !hasFiles) || store.isStreaming) return;

  let parsed: ParseResult[] | undefined;
  if (hasFiles) {
    parsed = await parseFiles(pendingFiles.value);
    pendingFiles.value = [];
  }
  text.value = '';
  void store.sendMessage(val || '(attached files)', parsed);
}
```

### [`SessionList.vue`](src/components/SessionList.vue)

Боковая панель со списком сессий:
- Кнопка **«New chat»** — создаёт новую сессию, переключается на неё и **сворачивает sidebar** (emit `session-selected`)
- Список сессий с активным highlight (`chatgpt-session--active`)
- Контекстное меню (три точки): **Rename** / **Delete**
- Диалог переименования
- **Footer-бар** внизу sidebar (`.chatgpt-sidebar-footer`):
  - **Settings** — открывает глобальный [`SettingsDialog`](src/components/SettingsDialog.vue) (API-ключ, endpoint, модель)
  - **Dark Mode / Light Mode** — переключает тему через `settingsStore.toggleDarkMode()`

Flex-контейнер для корректного скролла:
```scss
.chatgpt-sessions {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.chatgpt-sessions-scroll {
  flex: 1 1 0%;
  min-height: 0;
}
.chatgpt-sidebar-footer {
  border-top: 1px solid #e5e5e5;
  flex-shrink: 0;
}
```

### [`SettingsDialog.vue`](src/components/SettingsDialog.vue)

Модальный диалог **глобальных** настроек (открывается из пункта «Settings» в footer боковой панели):

**API Settings:**
- **API Endpoint** — базовый URL (по умолчанию `https://api.deepseek.com/v1`)
- **API Key** — поле с возможностью показать/скрыть (кнопка `visibility`)
- **Model** — выпадающий список (`q-select` с `use-input`) с известными моделями + возможность ввода кастомной
- **Token Limit** — максимальное количество токенов контекста (1000–2 000 000, шаг 1000, по умолчанию 200 000)

**Summary Settings:**
- **Summary Model** — модель для генерации саммари (по умолчанию — основная модель)

**Vision Settings:**
- **Enable image attachments** (`q-toggle`) — включает поддержку изображений
- **Vision model** — модель для распознавания изображений (недоступна при выключенном vision)

**Google Drive Sync:**
- Встроенный [`SyncSettings`](src/components/SyncSettings.vue) компонент

**Web Search (Tavily):**
- **Enable web search** (`q-toggle`) — включает интернет-поиск
- **Tavily API Key** — ключ API Tavily (доступен только при включённом поиске)

**Валидация**: endpoint и model обязательны.

Известные модели: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-chat`, `deepseek-reasoner`

### [`ChatSettingsDialog.vue`](src/components/ChatSettingsDialog.vue)

Диалог настроек конкретного чата (фиксированная ширина 440px, плотный режим):
- **System Prompt** — многострочное поле (`q-input` type `textarea`, autogrow), лимит 10000 символов со счётчиком
- **Загрузка из файла** — `q-file` для выбора `.txt` файла (макс. 1 MB)
- **Auto Summary** — переключатель (`q-toggle`) для включения/выключения авто-саммари диалога

### [`StepVoiceOverlay.vue`](src/components/StepVoiceOverlay.vue)

Полноэкранный оверлей для Step-by-Step Voice Mode. Состояния:

| Состояние | Иконка | Цвет кнопки | Описание |
|-----------|--------|-------------|----------|
| `idle` | 🎤 mic | Синий | Ожидание нажатия |
| `listening` (без текста) | 🎤 mic | Красный (пульсирует) | Микрофон слушает |
| `listening` (с текстом) | 📤 send | Зелёный (пульсирует) | Есть текст для отправки |
| `thinking` | ⏳ spinner | Оранжевый | LLM обрабатывает |
| `speaking` | ⏹ stop | Зелёный (пульсирует) | TTS озвучивает ответ |

**Элементы управления:**
- **Верхняя панель** — AutoSend toggle + настройка таймаута (±500ms)
- **Центральная кнопка** — 140×140px, меняет иконку/цвет по состоянию
- **Транскрипт** — набираемый текст (listening) или ответ (speaking)
- **Нижняя панель** — настройка скорости речи (±5%, 30–200%)
- **Кнопка закрытия** — крестик в правом верхнем углу

### [`SyncSettings.vue`](src/components/SyncSettings.vue)

Компонент управления Google Drive синхронизацией (встроен в [`SettingsDialog`](src/components/SettingsDialog.vue)):

- **Не авторизован**: кнопка «Sign in with Google» + описание
- **Авторизован**:
  - Статус: «✓ Signed in as user@gmail.com»
  - Кнопка «Sign Out»
  - Toggle «Auto Sync»
  - Кнопки «Upload» (push) и «Download» (pull с подтверждением)
  - Статус последней синхронизации / ошибка
- **Pull confirmation dialog** — предупреждение о замене всех локальных данных

---

## 6. Layout и страницы

### [`MainLayout.vue`](src/layouts/MainLayout.vue)

Корневой layout приложения:
- **Header** с кнопкой меню (бургер), заголовком «Simple LLM Chat» и кнопками:
  - 🔊 **TTS** — озвучивание последнего ответа ассистента. При активном озвучивании — меню со слайдером скорости (30–200%) и кнопкой Stop
  - 🎤 **Step Voice** — запуск/остановка Step Voice Mode. Подсвечивается зелёным когда активен
  - 🧠 **User Facts** — открывает диалог просмотра/редактирования фактов о пользователе
  - ⚙️ **Chat Settings** — открывает [`ChatSettingsDialog`](src/components/ChatSettingsDialog.vue)
- **Sync notification banner** — всплывающее уведомление «✓ Uploaded to Drive» / «✗ Sync error» при синхронизации (авто-скрытие через 3с)
- **Sidebar** (`q-drawer`) — содержит [`SessionList`](src/components/SessionList.vue)
- **Сворачивание sidebar**: при выборе/создании чата (`@session-selected`) sidebar автоматически закрывается (`leftDrawerOpen = false`)
- **TTS control bar** — нижняя панель, видимая во время озвучивания
- **StepVoiceOverlay** — полноэкранный оверлей голосового режима

### [`ChatPage.vue`](src/pages/ChatPage.vue)

Основная страница чата:
- **Header** (`q-bar`) — название текущей сессии
- **Баннер ошибок** — красный, с кнопкой закрытия
- **Баннер фактов** (`.chatgpt-facts-banner`) — жёлтое информационное уведомление, появляется когда LLM обнаружил новые факты о пользователе
- **Welcome screen** — логотип ChatLLM + «How can I help you?»
- **Список сообщений** (`v-for` по `store.displayMessages`):
  - Ассистент: зелёный логотип слева, markdown-рендеринг
  - Пользователь: зелёный круг с иконкой человека слева
  - **Чипы файлов** в user-сообщениях: иконка + имя + размер
  - **Кнопки действий**: Copy (user + assistant), Edit (только user, на всех сообщениях)
- **Режим редактирования**: `q-input` (textarea), Cancel и «Save & Submit», Ctrl+Enter для отправки. Обрезает сообщения после редактируемого и перезапускает стриминг
- **Стриминг-индикатор**: `q-spinner-dots` — показывается когда `isStreaming && !lastAssistantContent`
- **Скролл**: flex-раскладка, автоскролл при новых сообщениях и во время стриминга

### [`VoiceDebugPage.vue`](src/pages/VoiceDebugPage.vue)

Страница отладки голосового ввода (маршрут: `/voice-debug`):
- Кнопки Start/Stop/Clear/Copy log
- Текущий транскрипт (interim)
- Финальный результат (accumulated)
- Event log с временными метками (тёмная тема, моноширинный шрифт, автоскролл)

---

## 7. Сторы Pinia

### [`chatStore.ts`](src/stores/chatStore.ts) — состояние чата

| State | Тип | Описание |
|-------|-----|----------|
| `sessions` | `Ref<Session[]>` | Все сессии |
| `currentSessionId` | `Ref<string \| null>` | ID активной сессии |
| `messages` | `Ref<Message[]>` | Сообщения текущей сессии |
| `isStreaming` | `Ref<boolean>` | Флаг активного стриминга |
| `isSearching` | `Ref<boolean>` | Флаг выполнения поиска (Tavily) |
| `isSummarizing` | `Ref<boolean>` | Флаг генерации саммари |
| `error` | `Ref<string \| null>` | Сообщение об ошибке |
| `factsNotification` | `Ref<string[] \| null>` | Новые факты для баннера |

| Getter | Описание |
|--------|----------|
| `currentSession` | Активная сессия (из `sessions`) |
| `displayMessages` | `messages` без system/searchResult, без пустых assistant, без tool-call JSON |

| Action | Описание |
|--------|----------|
| `init()` | Загрузка сессий, выбор последней активной (из localStorage `chatgpt-last-session`) |
| `createSession(title?)` | Создание сессии, авто-переключение |
| `selectSession(id)` | Загрузка сообщений выбранной сессии |
| `renameSession(id, title)` | Переименование + `syncService.enqueueSync(id)` |
| `updateSystemPrompt(prompt)` | Сохранение/очистка system prompt + синхронизация |
| `removeSession(id)` | Удаление сессии + сообщений + файла из Drive |
| `sendMessage(text, parsedFiles?)` | Отправка сообщения с файлами + SSE-стриминг с tool loop |
| `cancelStream()` | Отмена стриминга через `AbortController` |
| `editMessage(id, newText)` | Редактирование с обрезанием последующих сообщений и перезапуском |

**Ключевые особенности**:
- `toRaw()` используется перед сохранением в IndexedDB, чтобы избежать `DataCloneError`
- Авто-заголовок: при первом сообщении в сессии `title` заменяется на первые 50 символов текста
- При отмене/ошибке стриминга пустое assistant-сообщение удаляется из `messages`

**Обрезка контекста** (`buildTrimmedMessages`):

Собирает массив `LlmMessage[]` для отправки в API:
1. System prompt (если задан) — всегда первым
2. User Facts — глобальная база знаний (если есть)
3. Rolling summary (если есть) — как system-контекст
4. Сообщения user/assistant с конца, пока сумма токенов ≤ лимит
5. `searchResult` маппится в `user` роль
6. Оценка токенов: `Math.ceil(content.length / 4) + 4`

**Tool-calling loop** (`streamWithToolLoop`):

Автоматический цикл «LLM → поиск → LLM» (до 3 раундов):
1. Стриминг ответа от LLM
2. `detectToolCall()` — проверка, является ли ответ JSON `{"search":"..."}"`
3. Если tool call обнаружен:
   - Удаление assistant-сообщения с JSON (не показывается в UI)
   - `searchWeb()` через Tavily API → создание `searchResult` сообщения
   - Новый assistant → повторный стриминг
4. Search system prompt с правилами: когда искать, формат JSON, текущая дата

**Файловые вложения в sendMessage**:
- Парсинг `ParseResult[]` → разделение на текст и изображения
- Изображения: `dataUrl` → vision-формат (`[{type: "image_url", ...}, {type: "text", ...}]`)
- Текст: вставка `[Attached file: name]\n{content}` перед последним user-сообщением
- Если есть изображения + `visionEnabled` → используется `visionModel`

**Отладочное логирование**: полный payload выводится в консоль при каждом вызове `sendMessage()`, `editMessage()` и `maybeSummarize()`.

### [`settingsStore.ts`](src/stores/settingsStore.ts) — настройки

| State | Тип | По умолчанию | Хранилище | Описание |
|-------|-----|-------------|-----------|----------|
| `endpoint` | `Ref<string>` | `https://api.deepseek.com/v1` | IndexedDB | Базовый URL API |
| `apiKey` | `Ref<string>` | `''` | IndexedDB | API-ключ |
| `model` | `Ref<string>` | `deepseek-chat` | IndexedDB | Название модели |
| `summaryModel` | `Ref<string>` | `deepseek-chat` | IndexedDB | Модель для саммари |
| `tokenLimit` | `Ref<number>` | `200000` | IndexedDB | Лимит токенов |
| `userFacts` | `Ref<string[]>` | `[]` | IndexedDB | Глобальная база знаний (JSON-сериализация) |
| `searchApiKey` | `Ref<string>` | `''` | IndexedDB | API-ключ Tavily |
| `searchEnabled` | `Ref<boolean>` | `false` | IndexedDB | Включён ли веб-поиск |
| `visionEnabled` | `Ref<boolean>` | `false` | IndexedDB | Включена ли поддержка изображений |
| `visionModel` | `Ref<string>` | `deepseek-chat` | IndexedDB | Модель для Vision |
| `googleDriveEnabled` | `Ref<boolean>` | `false` | IndexedDB | Включена ли синхронизация |
| `googleDriveEmail` | `Ref<string>` | `''` | IndexedDB | Email Google аккаунта |
| `ttsRate` | `Ref<number>` | `1.0` | IndexedDB | Скорость TTS (0.3–2.0) |
| `stepVoiceTimeout` | `Ref<number>` | `3000` | IndexedDB | Таймаут автоотправки (ms, 0 = выкл) |
| `darkMode` | `Ref<boolean>` | `false` | **localStorage** | Тёмная тема |

Actions: `load()`, `saveEndpoint`, `saveApiKey`, `saveModel`, `saveSummaryModel`, `saveTokenLimit`, `saveUserFacts`, `addFact`, `removeFact`, `saveSearchApiKey`, `saveSearchEnabled`, `saveVisionEnabled`, `saveVisionModel`, `saveGoogleDriveEnabled`, `saveGoogleDriveEmail`, `saveTtsRate`, `saveStepVoiceTimeout`, `toggleDarkMode`

---

## 8. Сервисы

### [`db.ts`](src/services/db.ts) — IndexedDB

Singleton-подключение через `idb` (openDB). Ленивая инициализация.

**Экспортируемые функции**:
- `getAllSessions()` — все сессии, сортировка по `updatedAt` DESC
- `getSession(id)` — одна сессия
- `putSession(session)` — upsert сессии
- `deleteSession(id)` — транзакционное удаление сессии + всех её сообщений
- `getMessages(sessionId)` — сообщения сессии, сортировка по `createdAt` ASC
- `putMessage(msg)` — upsert сообщения, возвращает авто-инкрементный `id`
- `deleteMessage(id)` — удаление одного сообщения
- `deleteMessagesBySession(sessionId)` — удаление всех сообщений сессии
- `getSetting(key)` — чтение настройки
- `putSetting(key, value)` — запись настройки

### [`llmProvider.ts`](src/services/llmProvider.ts) — OpenAI-совместимый клиент

**Интерфейсы**:
```typescript
interface LlmMessage { role: 'user' | 'assistant' | 'system'; content: string; }

interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onReasoning?: (text: string) => void;  // Для DeepSeek R1
  onDone: (fullContent: string) => void;
  onError: (error: Error) => void;
}

interface ChatParams { endpoint: string; apiKey: string; model: string; messages: LlmMessage[]; }
```

**`streamChat(params, callbacks, signal?)`**:
1. `POST {endpoint}/chat/completions` с `{ model, messages, stream: true }`
2. Чтение `ReadableStream` через `response.body.getReader()`
3. Построчный парсинг SSE: строки вида `data: {...}`
4. Извлечение `delta.content` и `delta.reasoning_content` из чанков
5. Обработка `data: [DONE]`
6. Обработка `AbortError` (нормальная отмена)

**`chat(params, signal?)`** — не-стриминговый вызов (для саммари, фактов)

### [`fileParser.ts`](src/services/fileParser.ts) — парсер файлов

**Интерфейс**:
```typescript
interface ParseResult {
  name: string;
  text: string;
  size: number;
  dataUrl?: string;  // base64 для изображений
}
```

**Функции**:
- `isImage(file)` — проверка MIME-типа (PNG, JPEG, GIF, WebP)
- `parseImageToBase64(file)` — кодирование в base64 data URL
- `parseFile(file)` — чтение любого файла как UTF-8 текст (через `FileReader.readAsText`)
- `parseFiles(files)` — параллельный парсинг, разделение на изображения и текст

### [`googleDriveProvider.ts`](src/services/googleDriveProvider.ts) — Google Drive API клиент

**Авторизация**: Google Identity Services (GIS) OAuth 2.0 implicit flow.
- Scope: `drive.file` + `userinfo.email`
- Токен хранится в `localStorage` (переживает перезагрузку)
- Авто-восстановление токена из `localStorage` при старте

**Структура в Drive**:
```
📁 OpenAI-Chat-Backup/
├── 📄 manifest.json        # Мета-информация о бэкапе
├── 📄 sessions.json        # Список всех сессий (без сообщений)
├── 📄 user-facts.json      # User Facts
└── 📁 sessions/
    └── 📄 {sessionId}.json # Сообщения одной сессии
```

**Публичное API** (`googleDriveProvider`):
- `signIn()` / `signOut()` — авторизация/выход
- `isSignedIn` — getter, проверка авторизации
- `getUserEmail()` — email пользователя
- `readManifest()` / `writeManifest()` — манифест
- `readSessions()` / `writeSessions()` — список сессий
- `readSessionMessages(sessionId)` / `writeSessionMessages(sessionId, messages)` — сообщения
- `readUserFacts()` / `writeUserFacts()` — факты
- `deleteSessionFile(sessionId)` — удаление файла сессии
- `checkBackupExists()` — проверка существования бэкапа

### [`searchProvider.ts`](src/services/searchProvider.ts) — Tavily Search API

**Интерфейсы**:
```typescript
interface TavilyResult { title: string; url: string; content: string; score: number; }
interface TavilyResponse { answer?: string; query: string; results: TavilyResult[]; response_time: number; }
```

- `searchWeb(query, apiKey)` — POST-запрос к Tavily API (basic depth, до 5 результатов, include_answer)
- `formatSearchResults(res)` — форматирование результатов в читаемый текст для LLM

### [`speechRecognition.ts`](src/services/speechRecognition.ts) — обёртка Web Speech API

Единая утилита для голосового ввода. Используется в [`ChatInput.vue`](src/components/ChatInput.vue) и [`stepVoiceService.ts`](src/services/stepVoiceService.ts).

**Особенности**:
- `continuous: true` на десктопе, `false` на мобильных (Samsung Chrome дублирует фразы)
- На мобильных: авто-рестарт через `onEnd` для непрерывной работы
- На десктопе: без авто-рестарта, управление через сервис
- Определение языка: `navigator.languages` → `Intl.DateTimeFormat` → `navigator.language`

**API**: `speechRecognition.start(callbacks)`, `speechRecognition.stop()`, `speechRecognition.isActive`

### [`stepVoiceService.ts`](src/services/stepVoiceService.ts) — Step-by-Step Voice Mode

Сервис полуавтоматического голосового режима. Состояния: `idle → listening → thinking → speaking → listening → ...`

**Состояние** (`stepVoiceState`):
- `isActive: Ref<boolean>` — активен ли режим
- `state: Ref<StepVoiceState>` — текущее состояние
- `transcript: Ref<string>` — надиктованный текст
- `responseText: Ref<string>` — ответ ассистента (для отображения при speaking)

**API** (`stepVoiceService`):
- `start()` / `stop()` — запуск/остановка режима
- `startListening()` — начать прослушивание (с high beep)
- `send()` — отправить надиктованный текст
- `stopSpeaking()` — прервать TTS

**Бипы** (AudioContext):
- High beep (1100Hz, 0.3s) — микрофон готов
- Low beep (440Hz, 0.3s) — сообщение отправлено (thinking)

**TTS**: `speakText()` — очистка markdown, озвучивание через `SpeechSynthesisUtterance` (скорость из `settingsStore.ttsRate`)

### [`syncService.ts`](src/services/syncService.ts) — оркестратор синхронизации

**Состояние** (`syncState`):
- `isSyncing`, `lastSyncAt`, `syncError`, `isSignedIn`, `userEmail`

**Стратегия**: debounce 2 секунды — группировка изменений перед отправкой в Drive.

**API** (`syncService`):
- `enqueueSync(sessionId)` — поставить сессию в очередь (вызывается после каждого изменения)
- `pushSession(sessionId, ...)` — принудительный push одной сессии
- `pushAll(...)` — полный push всех данных
- `pullAll(...)` — полный pull с мержем (Drive wins при новее `updatedAt`)
- `deleteSessionFile(sessionId)` — удаление файла сессии из Drive
- `updateAuthState()` — обновление статуса авторизации

**Триггеры синхронизации**: `sendMessage`, `editMessage`, `renameSession`, `updateSystemPrompt`, `maybeSummarize`, `removeSession`, `saveUserFacts`

### [`ttsSanitizer.ts`](src/services/ttsSanitizer.ts) — санитизация текста для TTS

- Удаление markdown (`#*_\`[]()>|~\\`)
- Удаление кавычек (всех типов)
- Замена `\n` на пробел, двойных `\n` — на точку
- Замена em-dash на пробел-тире-пробел
- Нормализация пробелов

---

## 9. Web Search (Tavily)

LLM может искать информацию в интернете через Tavily API. Поиск включается в [`SettingsDialog`](src/components/SettingsDialog.vue) (toggle «Enable web search» + Tavily API Key).

### Принцип работы

1. При включённом поиске `searchSystemPrompt()` добавляет инструкцию в system-сообщения:
   - Правила когда искать (новости, погода, текущие события, ключевые слова)
   - Формат ответа: только JSON `{"search":"query"}`
   - Текущая дата (русская и ISO) для формирования поисковых запросов
2. После каждого ответа LLM `detectToolCall()` проверяет, является ли ответ JSON tool call
3. Если да — `searchWeb()` → `searchResult` сообщение → новый стриминг с результатами
4. Цикл до 3 раундов (предотвращение бесконечного поиска)

### Отображение

- `searchResult` сообщения скрыты из UI (фильтр в `displayMessages`)
- Assistant-сообщения с JSON tool call тоже скрыты
- `searchMeta` сохраняется в assistant-сообщении (query + resultsCount)

---

## 10. Vision / Image Support

Поддержка изображений включается в [`SettingsDialog`](src/components/SettingsDialog.vue) (toggle «Enable image attachments» + выбор Vision model).

### Принцип работы

1. Пользователь прикрепляет изображения через кнопку 📎 в [`ChatInput.vue`](src/components/ChatInput.vue)
2. Изображения отображаются как чипы с превью
3. При отправке: `parseImageToBase64()` → `dataUrl` (base64)
4. Если `visionEnabled`:
   - Используется `visionModel` (или основная модель)
   - User-сообщение преобразуется в vision-формат:
     ```json
     {
       "role": "user",
       "content": [
         {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
         {"type": "text", "text": "user message text"}
       ]
     }
     ```
5. Если `visionEnabled` выключен — изображения игнорируются, только текст

---

## 11. File Attachments

Файлы прикрепляются через кнопку 📎 в [`ChatInput.vue`](src/components/ChatInput.vue).

### Принцип работы

1. Выбор файлов → чипы с именем и размером
2. При отправке: [`parseFiles()`](src/services/fileParser.ts) читает содержимое через `FileReader.readAsText()`
3. Изображения → base64 dataUrl, текст → UTF-8
4. [`chatStore.sendMessage()`](src/stores/chatStore.ts) вставляет содержимое перед последним user-сообщением:
   ```
   [Attached file: report.txt]
   ...содержимое...
   ---
   User: текст сообщения
   ```
5. В IndexedDB сохраняются только метаданные (`AttachmentMeta`: name, type, size), не содержимое

---

## 12. Google Drive Sync

Синхронизация данных чата через Google Drive. Настраивается в [`SyncSettings.vue`](src/components/SyncSettings.vue).

### Что синхронизируется

- Сессии (список + метаданные: title, systemPrompt, summary, summaryEnabled)
- Сообщения (все поля, включая reasoning, searchMeta, attachments)
- User Facts

### Что НЕ синхронизируется

- API-ключи (endpoint, apiKey, searchApiKey) — локальны для каждого устройства
- Настройки UI (darkMode, ttsRate и т.д.)

### Стратегия

- **Push**: debounce 2 секунды после каждого изменения. Инкрементальный (только изменённые сессии)
- **Pull**: только по явному действию пользователя с подтверждением. Слияние: Drive wins при новее `updatedAt`
- **Безопасность**: scope `drive.file` (приложение видит только свои файлы), токен в `localStorage` (переживает перезагрузку)

---

## 13. Step-by-Step Voice Mode

Полуавтоматический голосовой режим с оверлеем [`StepVoiceOverlay.vue`](src/components/StepVoiceOverlay.vue). Запускается кнопкой 🎤 в header [`MainLayout`](src/layouts/MainLayout.vue).

### Цикл состояний

```
idle → listening → listening (has text) → thinking → speaking → listening → ...
```

### Особенности

- **Ручное управление**: пользователь нажимает кнопку для старта/отправки
- **Автоотправка**: опциональный таймаут (0–10s, шаг 500ms) — сообщение отправляется автоматически после паузы
- **Бипы**: AudioContext-сигналы при старте микрофона (1100Hz) и отправке (440Hz)
- **TTS**: автоматическое озвучивание ответа ассистента (скорость 30–200%)
- **Язык**: автоопределение (ru/en), как в [`speechRecognition.ts`](src/services/speechRecognition.ts)
- **Мобильные**: `continuous: false` + авто-рестарт для предотвращения дублирования фраз

---

## 14. TTS (Text-to-Speech)

Озвучивание ответов ассистента через Web Speech API (`SpeechSynthesis`).

### В MainLayout

- Кнопка 🔊 в header — озвучивает последний ответ ассистента
- Меню со слайдером скорости и кнопкой Stop
- Нижняя панель управления во время озвучивания

### В Step Voice Mode

- Автоматическое озвучивание после получения ответа
- Очистка markdown перед озвучиванием (см. [`ttsSanitizer.ts`](src/services/ttsSanitizer.ts))
- Скорость из `settingsStore.ttsRate`

---

## 15. User Facts — глобальная база знаний о пользователе

Факты о пользователе извлекаются LLM во время саммаризации и сохраняются глобально.

### Принцип работы

1. При каждой саммаризации (каждые 20 сообщений) параллельно вызывается извлечение фактов
2. LLM получает строгий промпт: добавлять только критичную долгосрочную информацию (3 условия)
3. Новые факты сливаются с существующими (дедупликация)
4. Если список изменился — показывается баннер в [`ChatPage`](src/pages/ChatPage.vue)

### Управление

- Диалог «User Facts» (кнопка 🧠 в header [`MainLayout`](src/layouts/MainLayout.vue))
- Просмотр списком с удалением по одному
- Редактирование в textarea (один факт на строку)
- Добавление нового факта

### Инжекция в контекст

В [`buildTrimmedMessages()`](src/stores/chatStore.ts) факты вставляются как system-сообщение после system prompt:
```
[Global facts known about the user, use this info when relevant]
- факт 1
- факт 2
```

---

## 16. Rolling Summary (авто-саммари диалога)

Для сохранения контекста в длинных диалогах реализован паттерн *rolling summary* — периодическое краткое содержание чата, которое инжектится в контекст LLM.

### Принцип работы

```
Сообщения 1-20 → первое саммари
Сообщения 21-40 → обновление саммари (предыдущее + новые 20)
Сообщения 41-60 → обновление саммари (предыдущее + новые 20)
...
```

### Триггер и алгоритм

Срабатывает каждые **20** user/assistant сообщений. Использует не-стриминговый вызов `chat()` с моделью `summaryModel`. Промпт включает предыдущее саммари + последние 20 сообщений. Цель: ≤500 слов, тот же язык что и диалог.

### Настройки

| Где | Что | Пояснение |
|-----|-----|-----------|
| [`ChatSettingsDialog`](src/components/ChatSettingsDialog.vue) | Toggle «Auto Summary» | Включает/выключает для чата |
| [`SettingsDialog`](src/components/SettingsDialog.vue) | «Summary Model» | Модель для саммари |

---

## 17. PWA Support

Приложение поддерживает PWA (Progressive Web App) через Quasar PWA mode.

**Файлы**:
- [`src-pwa/custom-service-worker.js`](src-pwa/custom-service-worker.js) — service worker (workbox InjectManifest), pre-caching assets
- [`src-pwa/register-service-worker.js`](src-pwa/register-service-worker.js) — регистрация SW, авто-обновление при новой версии
- Иконки всех размеров в [`public/icons/`](public/icons/)
- Генератор иконок: [`scripts/generate-pwa-icons.mjs`](scripts/generate-pwa-icons.mjs)

---

## 18. Стилизация (ChatLLM UI)

### Светлая тема (по умолчанию)

| Элемент | Цвет |
|---------|------|
| Фон страницы | `#ffffff` |
| Фон сообщений пользователя | `#ffffff` |
| Фон сообщений ассистента | `#f7f7f8` |
| Sidebar | `#f9f9f9` |
| Header | `#ffffff`, border-bottom: `#e5e5e5` |
| Текст | `#1f1f1f` |
| Акцент (логотип, аватар) | `#10a37f` (ChatLLM green) |

### Тёмная тема (`body.body--dark`)

| Элемент | Цвет |
|---------|------|
| Фон страницы | `#343541` |
| Фон сообщений пользователя | `#343541` |
| Фон сообщений ассистента | `#3e3f4b` |
| Sidebar | `#202123` |
| Header | `#343541` |
| Текст | `#ececf1` |

### Раскладка чата (flex)

```
.chatgpt-layout (height: 100vh)
  └── .q-page-container (height: 100%)
       └── .chatgpt-page (display: flex; flex-direction: column; height: 100%)
            ├── .chatgpt-bar (flex-shrink: 0)
            ├── .chatgpt-messages (flex: 1 1 0%; min-height: 0; overflow-y: auto)
            └── .chatgpt-input-wrapper (flex-shrink: 0)
```

---

## 19. Решённые проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| Ошибка `marked` версии | Несовместимость с Node 12 | Закреплена версия `marked@11` |
| Ошибка Sass | Несовместимость `sass` 1.86+ с `@quasar/app` 3 | Закреплены `sass: "1.77.8"` и `sass-loader: "12.6.0"` |
| `DataCloneError` в IndexedDB | Реактивные прокси Vue не клонируются | `toRaw()` перед `putMessage()`/`putSession()` |
| API не получает последнее сообщение | Пустое assistant-сообщение попадало в payload | Фильтр `m.role === 'user' \|\| m.content !== ''` |
| Нет скролла в чате | Неправильная flex-раскладка | `min-height: 0` + `overflow-y: auto` на контейнере сообщений |
| Не видно списка сессий | `height: calc(100% - 60px)` без высоты родителя | Flex-контейнер: `flex: 1 1 0%; min-height: 0` |
| Двойной спиннер при стриминге | Пустое assistant-сообщение рендерилось в `v-for` + отдельный спиннер | Фильтр в `displayMessages` + условие `!lastAssistantContent` |
| Тема сбрасывалась в светлую при перезагрузке | `darkMode` хранился в IndexedDB (асинхронная загрузка) | Перенос в `localStorage` + inline-скрипт в `index.template.html` |
| Sidebar не сворачивался при выборе чата | Отсутствовала связь между `SessionList` и `MainLayout` | Emit `session-selected` из `SessionList` |
| Голосовой ввод выдаёт бессвязный текст | `continuous: true` + итерация с `i = 0` | Итерация от `event.resultIndex`, только `isFinal`-фрагменты |
| Распознавание всегда на английском | `navigator.language` возвращал `'en'` даже на русской системе | Цепочка из трёх источников |
| Мобильные браузеры дублируют фразы | `continuous: true` на Samsung Chrome | `continuous: false` на мобильных + авто-рестарт |

---

## 20. Конфигурация сборки

### [`quasar.conf.js`](quasar.conf.js)

- **TypeScript**: включён, лимит памяти 4096 MB
- **Плагины**: `Dark` (для переключения темы)
- **Роутинг**: hash mode
- **Dev-сервер**: порт 8080, авто-открытие браузера
- **Boot-файлы**: `i18n`, `pinia`
- **PWA**: workbox InjectManifest mode

### [`package.json`](package.json)

- Сборка: `npx quasar build` (SPA)
- Dev-сервер: `npx quasar dev`

---

## 21. Запуск

```bash
cd /home/devi/Develop/chat && npx quasar dev
```

Приложение открывается на `http://localhost:8080`. Все данные сохраняются в IndexedDB браузера и сохраняются между перезагрузками страницы. При включённой синхронизации данные также сохраняются в Google Drive.
