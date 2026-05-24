# ChatGPT-подобное чат-приложение на Quasar (Vue 3 + TypeScript)

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

---

## 2. Структура проекта

```
src/
├── components/
│   ├── ChatInput.vue            # Поле ввода сообщения
│   ├── SessionList.vue          # Список сессий в боковой панели
│   ├── SettingsDialog.vue       # Диалог глобальных настроек API + выбор модели для саммари
│   └── ChatSettingsDialog.vue   # Диалог настроек чата (system prompt, auto summary toggle)
├── css/
│   ├── app.scss                 # Глобальные стили (светлая + тёмная тема, ~730 строк)
│   └── quasar.variables.scss    # Переменные Quasar
├── layouts/
│   └── MainLayout.vue           # Корневой layout с header, sidebar и ChatSettingsDialog
├── pages/
│   └── ChatPage.vue             # Страница чата (сообщения, welcome, streaming, edit, copy)
├── router/
│   ├── index.ts                 # Конфигурация роутера
│   └── routes.ts                # Определения маршрутов
├── services/
│   ├── db.ts                    # Слой работы с IndexedDB (сессии, сообщения, настройки)
│   └── llmProvider.ts           # OpenAI-совместимый SSE-стриминговый клиент
└── stores/
    ├── chatStore.ts             # Pinia-стор чата (сессии, сообщения, стриминг, edit, rolling summary)
    └── settingsStore.ts         # Pinia-стор настроек (endpoint, apiKey, model, summaryModel, tokenLimit, darkMode)
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
`systemPrompt` | `string` (опционально) | Системный промпт (инструкция) для чата |
`summary` | `string` (опционально) | Краткое содержание диалога (rolling summary) |
`summaryEnabled` | `boolean` (опционально) | Включено ли авто-саммари для чата |

Индекс: `updatedAt`

### Object Store: `messages`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` (keyPath, autoIncrement) | `number` | Авто-инкрементный ID |
| `sessionId` | `string` | Внешний ключ на сессию |
| `role` | `'user' \| 'assistant' \| 'system'` | Роль отправителя |
| `content` | `string` | Текст сообщения |
| `createdAt` | `number` | Timestamp создания |

Индекс: `sessionId`

### Object Store: `settings`

| Поле | Тип | Описание |
|------|-----|----------|
| `key` (keyPath) | `string` | Ключ настройки |
| `value` | `string` | Значение (всегда строка) |

Ключи: `endpoint`, `apiKey`, `model`, `summaryModel`, `tokenLimit`, `userFacts`

> **Примечание**: `darkMode` вынесен из IndexedDB в `localStorage` для синхронного доступа (избежание мигания темы при загрузке).

---

## 4. Поток данных

```
User Input (ChatInput.vue)
  → chatStore.sendMessage(text)
    → Создание user-сообщения → putMessage() → IndexedDB
    → Авто-заголовок сессии (первое сообщение)
    → Создание пустого assistant-сообщения → putMessage() → IndexedDB
    → buildTrimmedMessages() — обрезка контекста по токенам
      → system prompt (если задан) всегда первым сообщением
      → rolling summary (если есть) вставляется как system-контекст
      → user/assistant сообщения, пока укладываются в лимит токенов
    → Формирование LlmMessage[] (system + user/assistant)
    → console.log полного payload для отладки
    → streamChat() (llmProvider.ts)
      → fetch POST /chat/completions (SSE, stream: true)
      → ReadableStream → построчное чтение → JSON-парсинг чанков
      → onChunk(delta) → обновление content в messages[idx]
      → onDone() → финальный putMessage() в IndexedDB
      → maybeSummarize() → фоновая генерация/обновление саммари диалога
```

---

## 5. Компоненты

### [`ChatInput.vue`](src/components/ChatInput.vue)

Поле ввода в стиле ChatGPT: pill-форма (border-radius: 24px), autogrow, кнопка отправки (стрелка вверх) / остановки (stop).

- **Enter** — отправка сообщения
- **Кнопка Stop** — отмена стриминга через `AbortController`
- **Отключено** во время стриминга
- **Disclaimer**: «ChatGPT can make mistakes. Check important info.»
- **Голосовой ввод** (кнопка микрофона в `#append` слоте):
  - Использует Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
  - Поддержка проверяется через `'SpeechRecognition' in window || 'webkitSpeechRecognition' in window`
  - Кнопка микрофона показывается только если API доступен
  - При активации: красная пульсирующая кнопка (CSS-анимация `pulse`), `recognition.start()`
  - **Определение языка**: цепочка из трёх источников:
    1. `navigator.languages` — упорядоченные предпочтения браузера
    2. `Intl.DateTimeFormat().resolvedOptions().locale` — локаль ОС
    3. `navigator.language` — язык интерфейса браузера
    - Если любой источник начинается с `ru` → `ru-RU`, иначе `en-US`
  - **Режим**: `continuous: true` + `interimResults: true`
  - **Обработка результатов**: итерация от `event.resultIndex`, добавление только `isFinal`-фрагментов через `text.value += ' ${result} '`
  - При потере фокуса/окончании: авто-остановка через `recognition.stop()`

```typescript
// Ключевая логика
function submit() {
  const val = text.value.trim();
  if (!val || store.isStreaming) return;
  text.value = '';
  store.sendMessage(val);
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

Модальный диалог **глобальных** настроек API (открывается из пункта «Settings» в footer боковой панели):
- **API Endpoint** — базовый URL (по умолчанию `https://api.deepseek.com/v1`)
- **API Key** — поле с возможностью показать/скрыть (кнопка `visibility`)
- **Model** — выпадающий список (`q-select` с `use-input`) с известными моделями + возможность ввода кастомной:
  - `deepseek-v4-flash`
  - `deepseek-v4-pro`
  - `deepseek-chat` (по умолчанию)
  - `deepseek-reasoner`
- **Token Limit** — максимальное количество токенов контекста (1000–2 000 000, шаг 1000, по умолчанию 200 000)
- **Save** — сохраняет все поля в IndexedDB через `settingsStore`
- **Валидация**: endpoint и model обязательны

### [`ChatSettingsDialog.vue`](src/components/ChatSettingsDialog.vue)

Диалог настроек конкретного чата. Открывается по нажатию на иконку шестерёнки в header (фиксированная ширина 440px, плотный режим):
- **System Prompt** — многострочное поле (`q-input` type `textarea`, autogrow), лимит 10000 символов со счётчиком
- **Загрузка из файла** — `q-file` для выбора `.txt` файла (макс. 1 MB), содержимое читается через `FileReader.readAsText()` и подставляется в поле ввода
- **Save/Cancel** — сохраняет system prompt в текущую сессию через `chatStore.updateSystemPrompt()` и обновляет запись в IndexedDB (поле `systemPrompt` в объекте сессии)
- При сохранении system prompt немедленно применяется — при следующей отправке сообщения он будет включён первым в payload
- **Auto Summary** — переключатель (`q-toggle`) для включения/выключения авто-саммари диалога:
  - При включении: `chatStore.updateSummaryEnabled(true)` — запускает механизм периодического саммари
  - При выключении: `chatStore.updateSummaryEnabled(false)` — очищает существующее саммари
  - Состояние хранится в `session.summaryEnabled` и персистится в IndexedDB
  - Описание: «Preserves context of long conversations via periodic summarization»

---

## 6. Layout и страницы

### [`MainLayout.vue`](src/layouts/MainLayout.vue)

Корневой layout приложения:
- **Header** с кнопкой меню (бургер), заголовком «ChatGPT» и кнопкой шестерёнки
- **Шестерёнка** → открывает [`ChatSettingsDialog`](src/components/ChatSettingsDialog.vue) (настройки чата: system prompt, загрузка из .txt)
- **Sidebar** (`q-drawer`) — содержит [`SessionList`](src/components/SessionList.vue)
- **Сворачивание sidebar**: при выборе/создании чата (`@session-selected`) sidebar автоматически закрывается (`leftDrawerOpen = false`)
- Глобальные настройки (API) вынесены в footer боковой панели — открываются через пункт «Settings» в [`SessionList`](src/components/SessionList.vue)

### [`ChatPage.vue`](src/pages/ChatPage.vue)

Основная страница чата:
- **Header** (`q-bar`) — название текущей сессии
- **Баннер ошибок** — красный, с кнопкой закрытия
- **Баннер фактов** (`.chatgpt-facts-banner`) — жёлтое информационное уведомление, появляется когда LLM обнаружил новые факты о пользователе во время саммаризации:
  - Текст: «New facts about you were discovered during summarization»
  - Кнопка «Review» — открывает диалог User Facts (в [`MainLayout`](src/layouts/MainLayout.vue))
  - Кнопка закрытия (×) — скрывает баннер
  - Автоматически скрывается при смене сессии
  - Управляется через `chatStore.factsNotification` (boolean)
- **Welcome screen** — логотип ChatGPT + «How can I help you?» (показывается когда нет сообщений и нет стриминга)
- **Список сообщений** (`v-for` по `store.displayMessages`):
  - Каждое сообщение — строка с аватаром и контентом
  - Ассистент: зелёный логотип ChatGPT слева
  - Пользователь: зелёный круг с иконкой человека слева
  - Markdown-рендеринг для ассистента (`marked` + `DOMPurify`)
  - **Кнопки действий** (`.chatgpt-msg-actions`) на каждом сообщении (кроме режима редактирования и стриминга):
    - **Copy** (`content_copy`) — копирует текст сообщения в буфер обмена через `navigator.clipboard.writeText()`, доступна для user и assistant сообщений
    - **Edit** (`edit`) — только на сообщениях пользователя, переводит сообщение в режим редактирования
- **Режим редактирования**: `q-input` (textarea), кнопки Cancel и «Save & Submit», Ctrl+Enter для отправки
  - При сохранении вызывается `chatStore.editMessage(id, newText)`, который **обрезает все сообщения после редактируемого** и перезапускает стриминг ответа от LLM
- **Стриминг-индикатор**: `q-spinner-dots` — показывается только когда нет контента в последнем assistant-сообщении
- **Скролл**: flex-раскладка, автоскролл при новых сообщениях и во время стриминга

**Исправление двойного спиннера**: фильтр в `displayMessages` скрывает пустые assistant-сообщения во время стриминга, а `lastAssistantContent` computed проверяет наличие текста в последнем assistant-сообщении — спиннер показывается только когда `isStreaming && !lastAssistantContent`.

---

## 7. Сторы Pinia

### [`chatStore.ts`](src/stores/chatStore.ts) — состояние чата

| State | Тип | Описание |
|-------|-----|----------|
| `sessions` | `Ref<Session[]>` | Все сессии |
| `currentSessionId` | `Ref<string \| null>` | ID активной сессии |
| `messages` | `Ref<Message[]>` | Сообщения текущей сессии |
| `isStreaming` | `Ref<boolean>` | Флаг активного стриминга |
| `error` | `Ref<string \| null>` | Сообщение об ошибке |

| Getter | Описание |
|--------|----------|
| `currentSession` | Активная сессия (из `sessions`) |
| `displayMessages` | `messages` без system и без пустых assistant при стриминге |

| Action | Описание |
|--------|----------|
| `init()` | Загрузка сессий, выбор первой |
| `createSession(title?)` | Создание сессии, авто-переключение |
| `selectSession(id)` | Загрузка сообщений выбранной сессии |
| `renameSession(id, title)` | Переименование с сохранением в IndexedDB |
| `updateSystemPrompt(prompt)` | Сохранение/очистка system prompt для текущей сессии (в IndexedDB) |
| `removeSession(id)` | Удаление сессии + все её сообщения (транзакция в IndexedDB) |
| `sendMessage(text)` | Отправка сообщения + SSE-стриминг ответа (с обрезкой контекста и system prompt) |
| `cancelStream()` | Отмена стриминга через `AbortController` |
| `editMessage(id, newText)` | Редактирование с обрезанием последующих сообщений и перезапуском |

**Ключевые особенности**:
- `toRaw()` используется перед сохранением в IndexedDB, чтобы избежать `DataCloneError` (реактивные прокси не клонируются)
- Авто-заголовок: при первом сообщении в сессии `title` заменяется на первые 50 символов текста
- При отмене/ошибке стриминга пустое assistant-сообщение удаляется из `messages`

**Обрезка контекста** (`buildTrimmedMessages`):

Функция собирает массив `LlmMessage[]` для отправки в API с учётом лимита токенов:
1. System prompt (если задан) — всегда включается первым, его токены вычитаются из бюджета
2. Сообщения user/assistant добавляются с конца (последние N сообщений), пока сумма токенов ≤ лимит
3. Если сообщение не влезает целиком — оно пропускается, но остальные могут быть добавлены
4. Оценка токенов: `Math.ceil(content.length / 4) + 4` (≈4 символа на токен + 4 токена overhead на сообщение)
5. Лимит по умолчанию: 200 000 токенов, настраивается в Settings → Token Limit

**Отладочное логирование**: полный payload (endpoint, model, messages с длинами контента) выводится в консоль при каждом вызове `sendMessage()` и `editMessage()`.

### [`settingsStore.ts`](src/stores/settingsStore.ts) — настройки

| State | Тип | По умолчанию | Хранилище | Описание |
|-------|-----|-------------|-----------|----------|
| `endpoint` | `Ref<string>` | `https://api.deepseek.com/v1` | IndexedDB | Базовый URL API |
| `apiKey` | `Ref<string>` | `''` | IndexedDB | API-ключ |
| `model` | `Ref<string>` | `deepseek-chat` | IndexedDB | Название модели |
| `summaryModel` | `Ref<string>` | `deepseek-chat` | IndexedDB | Модель для генерации саммари |
| `tokenLimit` | `Ref<number>` | `200000` | IndexedDB | Лимит токенов контекста |
| `userFacts` | `Ref<string>` | `''` | IndexedDB | Глобальная база знаний о пользователе |
| `darkMode` | `Ref<boolean>` | `false` | **localStorage** | Тёмная тема |

| Action | Описание |
|--------|----------|
| `load()` | Однократная загрузка endpoint/apiKey/model/summaryModel/tokenLimit/userFacts из IndexedDB; `darkMode` читается из `localStorage` синхронно при инициализации |
| `saveEndpoint(val)` | Сохранение endpoint |
| `saveApiKey(val)` | Сохранение API-ключа |
| `saveModel(val)` | Сохранение модели |
| `saveTokenLimit(val)` | Сохранение лимита токенов (число, в IndexedDB как строка) |
| `saveUserFacts(val)` | Сохранение глобальной базы знаний о пользователе |
| `toggleDarkMode()` | Переключение темы: `Dark.set()`, синхронная запись в `localStorage` (`chatgpt-dark-mode`) |

**Персистентность темы**: `darkMode` хранится в `localStorage` (ключ `chatgpt-dark-mode`), а не в IndexedDB. Это позволяет:
1. Синхронно прочитать значение при старте стора (без ожидания IndexedDB)
2. Применить тему в [`index.template.html`](src/index.template.html) через inline-скрипт **до** загрузки приложения — исключает мигание (flash) светлой темы при перезагрузке в тёмном режиме

```html
<!-- В index.template.html перед <div id="q-app"> -->
<script>
  (function() {
    try {
      if (localStorage.getItem('chatgpt-dark-mode') === 'true') {
        document.body.classList.add('body--dark');
      }
    } catch(e) {}
  })();
</script>
```

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
- `getSetting(key)` — чтение настройки
- `putSetting(key, value)` — запись настройки

### [`llmProvider.ts`](src/services/llmProvider.ts) — OpenAI-совместимый клиент

**Интерфейсы**:
```typescript
interface LlmMessage { role: 'user' | 'assistant' | 'system'; content: string; }

// eslint-disable-next-line no-unused-vars — требуется для декларации сигнатуры колбэков
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

**`chat(params, signal?)`** — не-стриминговый вызов (для будущих авто-заголовков и т.п.)

---

## 9. Стилизация (ChatGPT UI)

### Светлая тема (по умолчанию)

| Элемент | Цвет |
|---------|------|
| Фон страницы | `#ffffff` |
| Фон сообщений пользователя | `#ffffff` |
| Фон сообщений ассистента | `#f7f7f8` |
| Sidebar | `#f9f9f9` |
| Header | `#ffffff`, border-bottom: `#e5e5e5` |
| Текст | `#1f1f1f` |
| Акцент (логотип, аватар) | `#10a37f` (ChatGPT green) |

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

Ключевое правило для скролла: `flex: 1 1 0%; min-height: 0` на контейнере сообщений. Без `min-height: 0` flex-элемент игнорирует `overflow`.

---

## 10. Rolling Summary (авто-саммари диалога)

Для сохранения контекста в длинных диалогах реализован паттерн *rolling summary* — периодическое краткое содержание чата, которое инжектится в контекст LLM.

### Принцип работы

```
Сообщения 1-20 → первое саммари
Сообщения 21-40 → обновление саммари (предыдущее + новые 20)
Сообщения 41-60 → обновление саммари (предыдущее + новые 20)
...
```

Саммари хранится в поле [`Session.summary`](src/services/db.ts:9) и вставляется в payload как system-сообщение с префиксом `[Краткое содержание предыдущего диалога]`.

### Триггер

Срабатывает каждые **20** user/assistant сообщений (на 20, 40, 60, 80...). Вызывается в `onDone()` после каждого ответа ассистента. Если `summaryEnabled` выключен — молча пропускается.

### Алгоритм

```typescript
// chatStore.ts → maybeSummarize()
1. Проверка summaryEnabled для текущей сессии
2. Подсчёт user/assistant сообщений
3. Если кол-во кратно 20 → генерация
4. Формирование промпта:
   - предыдущее саммари (если есть) + последние 20 сообщений
   - инструкция: сохранить ключевую информацию, ≤500 слов
5. Не-стриминговый вызов chat() с моделью summaryModel (или основной)
6. Сохранение результата в session.summary → putSession() → IndexedDB
```

### Интеграция в buildTrimmedMessages()

```typescript
// После system prompt вставляется:
if (summary) {
  result.push({
    role: 'system',
    content: `[Краткое содержание предыдущего диалога]\n${summary}`,
  });
}
```

### Настройки

| Где | Что | Пояснение |
|-----|-----|-----------|
| [`ChatSettingsDialog`](src/components/ChatSettingsDialog.vue) | Toggle «Auto Summary» | Включает/выключает самари для конкретного чата. При выключении очищает существующее саммари |
| [`SettingsDialog`](src/components/SettingsDialog.vue) | «Summary Model» | Выбор модели для генерации самари (по умолчанию — основная модель) |
| [`settingsStore.summaryModel`](src/stores/settingsStore.ts:28) | `deepseek-chat` | Хранится в IndexedDB, ключ `summaryModel` |

### Отладочное логирование

При каждом вызове `maybeSummarize()` в консоль выводится:
- Причина пропуска (нет сессии / выключен / не кратно 20)
- Перед генерацией: endpoint, модель, длина промпта, длина предыдущего саммари, количество сообщений
- После генерации: длина нового саммари

---

## 11. User Facts — глобальная база знаний о пользователе

В дополнение к rolling summary реализована система накопления фактов о пользователе. Факты извлекаются LLM во время каждой саммаризации и сохраняются глобально (не привязаны к конкретной сессии).

### Принцип работы

```
Диалог → maybeSummarize()
  → генерация саммари диалога (как раньше)
  → параллельно: извлечение новых фактов о пользователе из последних 20 сообщений
  → слияние с существующей базой фактов (дедупликация, обновление противоречий)
  → сохранение в settingsStore.userFacts → IndexedDB (ключ `userFacts`)
```

### Промпт для извлечения фактов

LLM получает инструкцию:
- Извлечь ТОЛЬКО факты о пользователе (предпочтения, привычки, контекст, интересы, проекты, технологии, личные данные)
- Игнорировать факты об ассистенте, технические детали диалога, временные вопросы
- Каждый факт — одна строка
- Новые факты объединяются с существующими: дополнять, уточнять, удалять противоречивые
- Если новых фактов нет — вернуть существующий список без изменений

### Инжекция в контекст

В [`buildTrimmedMessages()`](src/stores/chatStore.ts:37) факты вставляются как system-сообщение сразу после system prompt (если он есть) и до остальных сообщений:

```typescript
// После system prompt и перед summary/сообщениями:
if (settingsStore.userFacts.trim()) {
  result.push({
    role: 'system',
    content: `[User Facts — long-term knowledge about the user]\n${settingsStore.userFacts}`,
  });
}
```

### Управление фактами

| Где | Что | Пояснение |
|-----|-----|-----------|
| [`MainLayout`](src/layouts/MainLayout.vue) | Кнопка «User Facts» в header | Открывает диалог просмотра/редактирования фактов |
| Диалог User Facts | `q-dialog` с `q-input` (textarea) | Позволяет вручную редактировать факты, сохранение через `settingsStore.saveUserFacts()` |
| [`ChatPage`](src/pages/ChatPage.vue) | Баннер уведомлений | Появляется когда обнаружены новые факты (`chatStore.factsNotification`) |

### Отладочное логирование

При извлечении фактов в консоль выводится:
- Количество существующих фактов до обновления
- Ответ LLM с новыми фактами
- Количество фактов после обновления

---

## 12. Решённые проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| Ошибка `marked` версии | Несовместимость с Node 12 | Закреплена версия `marked@11` |
| Ошибка Sass | Несовместимость `sass` 1.86+ с `@quasar/app` 3 | Закреплены `sass: "1.77.8"` и `sass-loader: "12.6.0"` |
| `DataCloneError` в IndexedDB | Реактивные прокси Vue не клонируются | `toRaw()` перед `putMessage()`/`putSession()` |
| API не получает последнее сообщение | Пустое assistant-сообщение попадало в payload | Фильтр `m.role === 'user' \|\| m.content !== ''` |
| Нет скролла в чате | Неправильная flex-раскладка | `min-height: 0` + `overflow-y: auto` на контейнере сообщений |
| Кнопка настроек не открывает меню | `@click` конфликтовал с `v-model` у `q-menu` | Убран `@click`, меню управляет собой само |
| Не видно списка сессий | `height: calc(100% - 60px)` без высоты родителя | Flex-контейнер: `flex: 1 1 0%; min-height: 0` |
| Двойной спиннер при стриминге | Пустое assistant-сообщение рендерилось в `v-for` + отдельный спиннер | Фильтр в `displayMessages` + условие `!lastAssistantContent` |
| 226 ошибок ESLint (airbnb-base + @typescript-eslint) | Конфликт Quasar автоформаттера (4 пробела в шаблонах) с airbnb-base indent (2 пробела), `max-len`, `@typescript-eslint/no-unsafe-*`, `no-non-null-assertion`, `no-floating-promises` и др. | Исправлено 9 файлов: `overrides` в `.eslintrc.js` (indent/max-len off для `.vue`), `eslint-disable` для `no-unsafe-*` в `router/index.ts` (Quasar typing limitation), замена `!` → `as string`/`?? 0`, `void` для floating promises, реорганизация кода |
| ESLint `no-unsafe-*` в `quasar.conf.js` | `chainWebpack` манипуляции с webpack chain API вызывали ошибки `@typescript-eslint/no-unsafe-member-access/assignment/return` | Директивы `eslint-disable` для трёх правил вынесены в заголовок файла (строки 11–13), блокируя проверку для всего файла конфигурации |
| ESLint `no-unused-vars` в `filterModels` (SettingsDialog.vue) | TypeScript-аннотация параметра `fn` в сигнатуре `q-select` проверяется линтером как неиспользуемая переменная | Блочный `/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */` вокруг функции `filterModels` |
| Тема сбрасывалась в светлую при перезагрузке | `darkMode` хранился в IndexedDB (асинхронная загрузка) | Перенос в `localStorage` (синхронный доступ) + inline-скрипт в `index.template.html` для применения темы до рендера |
| Sidebar не сворачивался при выборе чата | Отсутствовала связь между `SessionList` и `MainLayout` | Emit `session-selected` из `SessionList`, обработчик в `MainLayout` устанавливает `leftDrawerOpen = false` |
| Кнопка Edit только на последнем сообщении | Жёсткое условие `i === store.displayMessages.length - 1` | Убрано условие — теперь кнопка Edit на всех сообщениях пользователя |
| Sass-предупреждение о nested rules | `sass` 1.77.8 предупреждает о declarations после nested rules в `quasar.sass` | Попытка подавления через `quietDeps` в `chainWebpack` приводила к ошибке webpack (`Cannot read properties of undefined`). Оставлено как есть — варнинг не критичен. |
| Голосовой ввод выдаёт бессвязный текст | `continuous: true` + итерация с `i = 0` приводила к повторной обработке уже полученных результатов | Итерация от `event.resultIndex`, добавление только `isFinal`-фрагментов |
| Распознавание всегда на английском | `navigator.language` возвращал `'en'` даже на русской системе | Цепочка из трёх источников: `navigator.languages` → `Intl.DateTimeFormat().resolvedOptions().locale` → `navigator.language` |
| Ошибки TypeScript для Web Speech API | Нет типов для `SpeechRecognition` в DOM-типах | Минимальное объявление `Window { webkitSpeechRecognition: any }` в [`env.d.ts`](src/env.d.ts) + блочные `eslint-disable` для `any` |

---

## 13. Конфигурация сборки

### [`quasar.conf.js`](quasar.conf.js)

- **TypeScript**: включён, лимит памяти 4096 MB
- **Плагины**: `Dark` (для переключения темы)
- **Роутинг**: hash mode
- **Dev-сервер**: порт 8080, авто-открытие браузера
- **Boot-файлы**: `i18n`, `pinia`
- **ESLint**: в заголовке файла отключены правила `@typescript-eslint/no-unsafe-member-access`, `no-unsafe-assignment`, `no-unsafe-return` (webpack chain API не типизирован для Quasar)
- **chainWebpack**: пустой (не используется); попытка добавить `quietDeps` для sass-loader вызывала ошибки webpack и была отменена

### [`package.json`](package.json)

- Сборка: `npx quasar build` (SPA)
- Dev-сервер: `npx quasar dev`

---

## 14. Скриншоты и демонстрация

Сборка успешна. Запуск dev-сервера:

```bash
cd /home/devi/Develop/chat && npx quasar dev
```

Приложение открывается на `http://localhost:8080`. Все данные сохраняются в IndexedDB браузера и сохраняются между перезагрузками страницы.
