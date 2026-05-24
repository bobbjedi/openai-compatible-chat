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
│   ├── SettingsDialog.vue       # Диалог глобальных настроек API (в footer sidebar)
│   └── ChatSettingsDialog.vue   # Диалог настроек чата (заглушка, открывается из header)
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
    ├── chatStore.ts             # Pinia-стор чата (сессии, сообщения, стриминг, edit)
    └── settingsStore.ts         # Pinia-стор настроек (API-ключ, endpoint, модель, тема в localStorage)
```

---

## 3. Схема IndexedDB

База данных: `deepseek-chat` (версия 1)

### Object Store: `sessions`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` (keyPath) | `string` | UUID сессии |
| `title` | `string` | Название чата |
| `createdAt` | `number` | Timestamp создания |
| `updatedAt` | `number` | Timestamp последнего обновления |

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

Ключи: `endpoint`, `apiKey`, `model`

> **Примечание**: `darkMode` вынесен из IndexedDB в `localStorage` для синхронного доступа (избежание мигания темы при загрузке).

---

## 4. Поток данных

```
User Input (ChatInput.vue)
  → chatStore.sendMessage(text)
    → Создание user-сообщения → putMessage() → IndexedDB
    → Авто-заголовок сессии (первое сообщение)
    → Создание пустого assistant-сообщения → putMessage() → IndexedDB
    → Формирование LlmMessage[] из messages
    → streamChat() (llmProvider.ts)
      → fetch POST /chat/completions (SSE, stream: true)
      → ReadableStream → построчное чтение → JSON-парсинг чанков
      → onChunk(delta) → обновление content в messages[idx]
      → onDone() → финальный putMessage() в IndexedDB
```

---

## 5. Компоненты

### [`ChatInput.vue`](src/components/ChatInput.vue)

Поле ввода в стиле ChatGPT: pill-форма (border-radius: 24px), autogrow, кнопка отправки (стрелка вверх) / остановки (stop).

- **Enter** — отправка сообщения
- **Кнопка Stop** — отмена стриминга через `AbortController`
- **Отключено** во время стриминга
- **Disclaimer**: «ChatGPT can make mistakes. Check important info.»

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
- **Model** — название модели (по умолчанию `deepseek-chat`)
- **Save** — сохраняет все три поля в IndexedDB через `settingsStore`
- **Валидация**: endpoint и model обязательны

### [`ChatSettingsDialog.vue`](src/components/ChatSettingsDialog.vue)

Заглушка для будущих настроек конкретного чата. Открывается по нажатию на иконку шестерёнки в header.
Содержит пустой `q-card` с заголовком «Chat Settings» и кнопкой закрытия.

---

## 6. Layout и страницы

### [`MainLayout.vue`](src/layouts/MainLayout.vue)

Корневой layout приложения:
- **Header** с кнопкой меню (бургер), заголовком «ChatGPT» и кнопкой шестерёнки
- **Шестерёнка** → открывает [`ChatSettingsDialog`](src/components/ChatSettingsDialog.vue) (настройки чата, заглушка)
- **Sidebar** (`q-drawer`) — содержит [`SessionList`](src/components/SessionList.vue)
- **Сворачивание sidebar**: при выборе/создании чата (`@session-selected`) sidebar автоматически закрывается (`leftDrawerOpen = false`)
- Глобальные настройки (API) вынесены в footer боковой панели — открываются через пункт «Settings» в [`SessionList`](src/components/SessionList.vue)

### [`ChatPage.vue`](src/pages/ChatPage.vue)

Основная страница чата:
- **Header** (`q-bar`) — название текущей сессии
- **Баннер ошибок** — красный, с кнопкой закрытия
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
| `removeSession(id)` | Удаление сессии + все её сообщения (транзакция в IndexedDB) |
| `sendMessage(text)` | Отправка сообщения + SSE-стриминг ответа |
| `cancelStream()` | Отмена стриминга через `AbortController` |
| `editMessage(id, newText)` | Редактирование с обрезанием последующих сообщений и перезапуском |

**Ключевые особенности**:
- `toRaw()` используется перед сохранением в IndexedDB, чтобы избежать `DataCloneError` (реактивные прокси не клонируются)
- Авто-заголовок: при первом сообщении в сессии `title` заменяется на первые 50 символов текста
- При отмене/ошибке стриминга пустое assistant-сообщение удаляется из `messages`

### [`settingsStore.ts`](src/stores/settingsStore.ts) — настройки

| State | Тип | По умолчанию | Хранилище | Описание |
|-------|-----|-------------|-----------|----------|
| `endpoint` | `Ref<string>` | `https://api.deepseek.com/v1` | IndexedDB | Базовый URL API |
| `apiKey` | `Ref<string>` | `''` | IndexedDB | API-ключ |
| `model` | `Ref<string>` | `deepseek-chat` | IndexedDB | Название модели |
| `darkMode` | `Ref<boolean>` | `false` | **localStorage** | Тёмная тема |

| Action | Описание |
|--------|----------|
| `load()` | Однократная загрузка endpoint/apiKey/model из IndexedDB; `darkMode` читается из `localStorage` синхронно при инициализации |
| `saveEndpoint(val)` | Сохранение endpoint |
| `saveApiKey(val)` | Сохранение API-ключа |
| `saveModel(val)` | Сохранение модели |
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

## 10. Решённые проблемы

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
| Тема сбрасывалась в светлую при перезагрузке | `darkMode` хранился в IndexedDB (асинхронная загрузка) | Перенос в `localStorage` (синхронный доступ) + inline-скрипт в `index.template.html` для применения темы до рендера |
| Sidebar не сворачивался при выборе чата | Отсутствовала связь между `SessionList` и `MainLayout` | Emit `session-selected` из `SessionList`, обработчик в `MainLayout` устанавливает `leftDrawerOpen = false` |
| Кнопка Edit только на последнем сообщении | Жёсткое условие `i === store.displayMessages.length - 1` | Убрано условие — теперь кнопка Edit на всех сообщениях пользователя |

---

## 11. Конфигурация сборки

### [`quasar.conf.js`](quasar.conf.js)

- **TypeScript**: включён, лимит памяти 4096 MB
- **Плагины**: `Dark` (для переключения темы)
- **Роутинг**: hash mode
- **Dev-сервер**: порт 8080, авто-открытие браузера
- **Boot-файлы**: `i18n`, `pinia`

### [`package.json`](package.json)

- Сборка: `npx quasar build` (SPA)
- Dev-сервер: `npx quasar dev`

---

## 12. Скриншоты и демонстрация

Сборка успешна. Запуск dev-сервера:

```bash
cd /home/devi/Develop/chat && npx quasar dev
```

Приложение открывается на `http://localhost:8080`. Все данные сохраняются в IndexedDB браузера и сохраняются между перезагрузками страницы.
