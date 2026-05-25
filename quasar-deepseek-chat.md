# OpenAI-Compatible Chat — Документация проекта

## Технологический стек

| Слой | Технология |
|------|-----------|
| Фреймворк | Quasar CLI (Webpack, Vue 3, Composition API, TypeScript) |
| State | Pinia |
| Хранилище | IndexedDB (через `idb`) |
| API | Универсальный OpenAI-совместимый клиент (DeepSeek, OpenAI, любые прокси) |
| Стриминг | SSE (Server-Sent Events) через `fetch` + `ReadableStream` |
| Рендеринг | `marked` + `DOMPurify` |
| Поиск | Tavily Search API (tool-call loop) |
| Парсинг файлов | `FileReader.readAsText` — все текстовые форматы без библиотек |
| Ввод | Голосовой ввод через Web Speech API |
| Режим | SPA + PWA |

---

## Структура проекта (актуальная)

```
openai-compatible-chat/
├── quasar.conf.js                    # Конфигурация Quasar (Webpack, SPA + PWA)
├── package.json                      # Зависимости и скрипты
├── tsconfig.json                     # TypeScript-конфиг
├── src/
│   ├── App.vue                       # Корневой компонент (только <router-view>)
│   ├── layouts/
│   │   └── MainLayout.vue            # Шапка + сайдбар + ChatSettings + User Facts
│   ├── pages/
│   │   ├── ChatPage.vue              # Страница чата (markdown, reasoning, файлы, поиск)
│   │   ├── Error404.vue              # 404 страница
│   │   └── Index.vue                 # Заглушка (scaffold — можно удалить)
│   ├── components/
│   │   ├── ChatInput.vue             # Поле ввода + 📎 файлы + 🎤 голос + стоп
│   │   ├── SessionList.vue           # Список сессий + rename/delete + Settings
│   │   ├── SettingsDialog.vue        # API: эндпоинт, ключ, модель, Tavily
│   │   ├── ChatSettingsDialog.vue    # Чат: system prompt, auto-summary, загрузка .txt
│   │   ├── CompositionComponent.vue  # Демо (scaffold — можно удалить)
│   │   ├── EssentialLink.vue         # Демо (scaffold — можно удалить)
│   │   └── models.ts                 # Демо-типы (scaffold — можно удалить)
│   ├── stores/
│   │   ├── chatStore.ts              # Сессии, сообщения, стриминг, summary, facts, tool-loop
│   │   └── settingsStore.ts          # endpoint, apiKey, model, search, darkMode
│   ├── services/
│   │   ├── llmProvider.ts            # OpenAI-совместимый клиент (stream + non-stream)
│   │   ├── db.ts                     # IndexedDB (sessions, messages, settings)
│   │   ├── searchProvider.ts         # Tavily Search API-клиент
│   │   └── fileParser.ts             # Парсер файлов (все текстовые форматы)
│   ├── router/
│   │   ├── index.ts                  # Инициализация роутера
│   │   └── routes.ts                 # Маршруты (/ → ChatPage, 404)
│   ├── boot/
│   │   ├── pinia.ts                  # Инициализация Pinia
│   │   └── i18n.ts                   # Инициализация vue-i18n
│   ├── i18n/                         # Локализация (en-US)
│   ├── css/
│   │   ├── app.scss                  # ChatGPT-стиль: светлая/тёмная тема (~1000 строк)
│   │   └── quasar.variables.scss     # Переменные Quasar
│   └── assets/
├── src-pwa/                          # PWA: service worker, регистрация, манифест
├── plans/                            # Планы и архитектурные заметки
│   └── file-attachments.md
└── public/                           # Статика: favicon, иконки PWA
```

---

## Схема IndexedDB

```
Database: deepseek-chat (version 2)

ObjectStore: sessions
  keyPath: id (string, uuid)
  indexes: updatedAt (timestamp)
  Поля: id, title, createdAt, updatedAt, systemPrompt?, summary?, summaryEnabled?

ObjectStore: messages
  keyPath: id (autoIncrement)
  indexes: sessionId (string)
  Поля: id?, sessionId, role (user|assistant|system|searchResult),
        content, reasoning?, searchMeta?, attachments?, createdAt

ObjectStore: settings
  keyPath: key (string)
  Поля: key, value
```

---

## Поток данных

```mermaid
sequenceDiagram
    participant U as User
    participant CI as ChatInput.vue
    participant FP as fileParser.ts
    participant CS as chatStore (Pinia)
    participant LP as llmProvider.ts
    participant API as API (DeepSeek/OpenAI/etc)
    participant SP as searchProvider.ts
    participant TAV as Tavily API
    participant IDB as IndexedDB
    participant CP as ChatPage.vue

    U->>CI: Прикрепляет файлы 📎 + пишет текст
    CI->>FP: parseFiles(files)
    FP-->>CI: ParseResult[] (текст содержимого)
    CI->>CS: sendMessage(text, parsedFiles)
    CS->>CS: attachmentMetas[], filesContentText (для LLM)
    CS->>IDB: putMessage(userMsg) — только метаданные, не содержимое
    CS->>CS: user-сообщение в messages[] (чипы видны в UI)
    CS->>IDB: putMessage(empty assistantMsg)
    CS->>LP: streamChat(params, callbacks, signal)
    LP->>API: POST {endpoint}/chat/completions (stream: true)
    API-->>LP: SSE data chunks
    LP-->>CS: onChunk(delta), onReasoning(reasoning)
    CS->>CS: Дописывает delta/reasoning
    CS->>CP: Реактивно обновляет UI (markdown + reasoning)

    alt Обнаружен tool-call {"search":"..."} (строгий JSON)
        CS->>CS: Удаляет tool-call assistant из IDB и массива
        CS->>SP: searchWeb(query, tavilyKey)
        SP->>TAV: POST api.tavily.com/search
        TAV-->>SP: Результаты поиска
        SP-->>CS: formatted results
        CS->>IDB: putMessage(searchResultMsg, role='searchResult')
        CS->>CS: searchResult в messages[] (скрыт от UI)
        CS->>CS: Новый assistant с searchMeta (🌐 баннер)
        CS->>LP: streamChat (с search-результатами в контексте)
        Note over CS,API: До 3 раундов tool-call loop
    end

    CS->>IDB: putMessage(assistantMsg)
    CS->>CS: maybeSummarize() — каждые 20 сообщений
    CS->>LP: chat(summary prompt) + chat(facts prompt)
    LP->>API: POST (stream: false) ×2
    API-->>LP: summary text + facts list
    CS->>IDB: putSession(updated summary)
    CS->>IDB: putSetting(userFacts)
    CS->>CP: factsNotification баннер
```

---

## Роли сообщений

| Роль | Назначение | Видно в UI |
|------|-----------|------------|
| `user` | Сообщения пользователя | ✅ |
| `assistant` | Ответы модели | ✅ |
| `system` | System prompt (не сохраняется в messages) | ❌ |
| `searchResult` | Результаты поиска Tavily (только для LLM) | ❌ (скрыто) |

---

## API-клиент ([`llmProvider.ts`](src/services/llmProvider.ts))

### `streamChat(params, callbacks, signal?)`
- URL: `{endpoint}/chat/completions`
- Метод: POST
- Заголовки: `Authorization: Bearer {apiKey}`, `Content-Type: application/json`
- Тело: `{ model, messages, stream: true }`
- Стриминг: `fetch` + `response.body.getReader()` + парсинг SSE
- Поддержка `reasoning_content` (DeepSeek-R1)
- Поддержка `AbortController` (прерывание)
- Обработка `[DONE]`

### `chat(params, signal?)`
- Нестриминговая версия (summary, facts extraction)
- Возвращает `string`

---

## Search Provider ([`searchProvider.ts`](src/services/searchProvider.ts))

- **Tavily Search API**: `POST https://api.tavily.com/search`
- `searchWeb(query, apiKey)` — выполняет поиск
- `formatSearchResults(response)` — форматирует в текст для LLM
- Параметры: `search_depth: basic`, `include_answer: true`, `max_results: 5`

### Tool-call loop ([`chatStore.ts`](src/stores/chatStore.ts))

1. Модель отвечает **строгим JSON** `{"search":"запрос"}` — без текста до/после
2. `detectToolCall()` валидирует через `JSON.parse`
3. Tool-call assistant **полностью удаляется** из IDB и массива
4. Создаётся `searchResult` сообщение (роль `searchResult`, скрыто в UI)
5. Создаётся новый assistant с `searchMeta` — отображается с 🌐 баннером
6. Модель получает результаты поиска в контексте и отвечает
7. Максимум 3 раунда

### Обязательные триггеры поиска
Ключевые слова: «новости», «news», «сейчас», «now», «сегодня», «today», «последние», «latest», «текущий год», «2025», «2026». Любой вопрос о погоде, датах, котировках, спорте, новостях.

Запрещено выдумывать — модель обязана искать через `{"search":"..."}`.

---

## File Parser ([`fileParser.ts`](src/services/fileParser.ts))

Читает **любой** файл как UTF-8 текст через `FileReader.readAsText()`. Без фильтрации по расширениям или MIME-типам.

```typescript
interface ParseResult {
  name: string;   // transactions.html
  text: string;   // содержимое файла
  size: number;   // 1131
}
```

### Поддерживаемые форматы
Все текстовые: `txt`, `yaml`, `yml`, `md`, `json`, `xml`, `csv`, `tsv`, `toml`, `ini`, `env`, `html`, `css`, `js`, `ts`, `py`, `java`, `c`, `cpp`, `go`, `rs`, `rb`, `php`, `sql`, `sh`, и десятки других — любой файл читается как текст.

### Как работает
- **В UI:** чипы `📄 filename — 128 KB` в ChatInput и в user-сообщениях
- **В IDB:** только метаданные (`name`, `type`, `size`), содержимое НЕ хранится
- **В LLM:** содержимое вставляется в payload: `[Attached file: name]\n{content}\n\n---\nUser: {text}`

---

## ChatInput ([`ChatInput.vue`](src/components/ChatInput.vue))

### Ввод
- Поле с авто-расширением (autogrow)
- **Десктоп:** Enter → отправка, Shift+Enter → перенос строки
- **Телефон:** Enter → перенос строки, отправка по кнопке ▶
- Определение мобильного через `navigator.userAgent`

### Прикрепление файлов 📎
- Скрытый `<input type="file" multiple>`
- Чипы файлов над полем ввода (можно удалить)
- Парсинг через [`fileParser.ts`](src/services/fileParser.ts) перед отправкой

### Голосовой ввод 🎤
- Web Speech API (SpeechRecognition)
- Авто-определение языка (ru-RU / en-US)
- Только финальные результаты добавляются в поле
- Анимация пульсации при записи

### Действия
- Кнопка Stop при активном стриминге
- Отключение ввода во время стриминга

---

## Settings Store ([`settingsStore.ts`](src/stores/settingsStore.ts))

| Поле | Тип | По умолчанию | Описание |
|------|-----|-------------|----------|
| `endpoint` | string | `https://api.deepseek.com/v1` | Базовый URL API |
| `apiKey` | string | `''` | API-ключ |
| `model` | string | `deepseek-chat` | Основная модель |
| `summaryModel` | string | `deepseek-chat` | Модель для summary |
| `tokenLimit` | number | `200000` | Лимит токенов контекста |
| `userFacts` | string[] | `[]` | Факты о пользователе (авто-извлечение) |
| `searchApiKey` | string | `''` | Tavily API-ключ |
| `searchEnabled` | boolean | `false` | Включен ли веб-поиск |
| `darkMode` | boolean | `false` | Тёмная тема (localStorage) |

---

## Chat Store ([`chatStore.ts`](src/stores/chatStore.ts))

### Основные возможности
- **Управление сессиями**: создание, выбор, переименование, удаление
- **Прикрепление файлов**: `sendMessage(text, parsedFiles?)` — метаданные в IDB, содержимое в LLM
- **SSE-стриминг**: с прерыванием через AbortController
- **Веб-поиск**: tool-call loop до 3 раундов, строгий JSON `{"search":"..."}`
- **Token budget**: `buildTrimmedMessages()` — обрезка истории
- **Rolling Summary**: авто-суммаризация каждые 20 сообщений
- **User Facts**: авто-извлечение фактов о пользователе при summary
- **Редактирование сообщений**: `editMessage()` — переотправка с удалением последующих
- **System Prompt**: настраиваемый для каждой сессии

### Ключевые функции
- `sendMessage(text, parsedFiles?)` — отправка с файлами и tool-loop
- `editMessage(id, newText)` — редактирование и переотправка
- `cancelStream()` — прерывание через AbortController
- `maybeSummarize()` — авто-суммаризация + извлечение фактов
- `buildTrimmedMessages()` — обрезка истории под token budget
- `detectToolCall(text)` — поиск `{"search":"..."}` как чистого JSON
- `searchSystemPrompt()` — промпт с правилами tool-calling

---

## ChatPage ([`ChatPage.vue`](src/pages/ChatPage.vue))

### Рендеринг
- Markdown через `marked` + `DOMPurify` (XSS-безопасность)
- Reasoning-блоки (DeepSeek-R1): collapsible, авто-раскрытие при стриминге
- 🌐 Search meta баннер на assistant-сообщениях: «погода Москва — 5 result(s)»
- 📄 Чипы файлов в user-сообщениях
- User Facts баннер с просмотром и inline-редактированием
- Summary диалог (полноэкранный просмотр)
- Индикаторы: спиннер при стриминге, «Searching the web...» при поиске

### Действия с сообщениями
- Копирование текста (clipboard API)
- Редактирование user-сообщений (Ctrl+Enter)

### Welcome-экран
- Показывается при отсутствии сообщений

---

## SessionList ([`SessionList.vue`](src/components/SessionList.vue))

- Список сессий с подсветкой активной
- Контекстное меню: Rename / Delete
- Кнопка «New chat»
- Нижняя панель: Settings / Dark Mode toggle / версия приложения
- Адаптивное поведение: авто-закрытие сайдбара на мобильных

---

## Настройки API ([`SettingsDialog.vue`](src/components/SettingsDialog.vue))

- API Endpoint
- API Key (с переключением видимости)
- Model (выпадающий список + ручной ввод: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-chat`, `deepseek-reasoner`)
- Token Limit (1000–2 000 000)
- Summary Model
- Web Search: toggle + Tavily API Key

---

## Настройки чата ([`ChatSettingsDialog.vue`](src/components/ChatSettingsDialog.vue))

- Auto Summary toggle
- System Prompt (textarea, до 10 000 символов)
- Загрузка system prompt из .txt файла

---

## Полный список возможностей

| Возможность | Реализация |
|-------------|-----------|
| SSE-стриминг с reasoning | [`llmProvider.ts`](src/services/llmProvider.ts) |
| Веб-поиск (Tavily) + tool-call loop | [`searchProvider.ts`](src/services/searchProvider.ts) + [`chatStore.ts`](src/stores/chatStore.ts) |
| Прикрепление файлов (все текстовые форматы) | [`fileParser.ts`](src/services/fileParser.ts) + [`ChatInput.vue`](src/components/ChatInput.vue) |
| Голосовой ввод (SpeechRecognition) | [`ChatInput.vue`](src/components/ChatInput.vue) |
| Rolling Summary (каждые 20 сообщений) | [`chatStore.ts`](src/stores/chatStore.ts) → `maybeSummarize()` |
| User Facts (авто-извлечение) | [`chatStore.ts`](src/stores/chatStore.ts) → facts extraction |
| Тёмная тема | [`settingsStore.ts`](src/stores/settingsStore.ts) + [`app.scss`](src/css/app.scss) |
| Редактирование сообщений | [`chatStore.ts`](src/stores/chatStore.ts) → `editMessage()` |
| Token budget management | [`chatStore.ts`](src/stores/chatStore.ts) → `buildTrimmedMessages()` |
| Reasoning display (R1) | [`ChatPage.vue`](src/pages/ChatPage.vue) — collapsible |
| Адаптивный Enter (десктоп/телефон) | [`ChatInput.vue`](src/components/ChatInput.vue) → `onEnterKey()` |
| PWA поддержка | `src-pwa/` + [`quasar.conf.js`](quasar.conf.js) |
| i18n (базовая) | `src/i18n/` |

---

## Зависимости ([`package.json`](package.json))

| Пакет | Версия | Назначение |
|-------|--------|-----------|
| `quasar` | ^2.14.0 | UI-фреймворк |
| `vue` | ^3.0.0 | Реактивный фреймворк |
| `pinia` | ^2 | State management |
| `idb` | ^8.0.3 | IndexedDB-обёртка |
| `marked` | ^11 | Markdown-рендеринг |
| `dompurify` | ^3.4.5 | XSS-санитизация HTML |
| `vue-router` | ^4.0.0 | Маршрутизация |
| `vue-i18n` | ^9.0.0 | Локализация |
| `core-js` | ^3.6.5 | Полифилы |
| `@quasar/extras` | ^1.0.0 | Иконки и шрифты |

---

## Конфигурация Quasar ([`quasar.conf.js`](quasar.conf.js))

- **Тип**: SPA (с PWA)
- **Роутер**: hash mode
- **Public Path**: `/openai-compatible-chat/`
- **Dev-сервер**: порт 8080
- **Boot**: `i18n`, `pinia`
- **Плагины**: `Dark`
- **PWA**: Workbox GenerateSW

---

## Файлы для удаления (scaffold)

| Файл | Причина |
|------|---------|
| [`src/components/CompositionComponent.vue`](src/components/CompositionComponent.vue) | Демо Quasar scaffold |
| [`src/components/EssentialLink.vue`](src/components/EssentialLink.vue) | Демо Quasar scaffold |
| [`src/components/models.ts`](src/components/models.ts) | Демо-типы (не используются) |
| [`src/pages/Index.vue`](src/pages/Index.vue) | Заглушка (не в роутах) |
