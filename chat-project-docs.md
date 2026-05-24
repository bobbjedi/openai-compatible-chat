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
│   ├── ChatInput.vue         # Поле ввода сообщения
│   ├── SessionList.vue       # Список сессий в боковой панели
│   └── SettingsDialog.vue    # Диалог настроек API
├── css/
│   ├── app.scss              # Глобальные стили (светлая + тёмная тема, ~713 строк)
│   └── quasar.variables.scss # Переменные Quasar
├── layouts/
│   └── MainLayout.vue        # Корневой layout с header, sidebar и меню настроек
├── pages/
│   └── ChatPage.vue          # Страница чата (сообщения, welcome, streaming)
├── router/
│   ├── index.ts              # Конфигурация роутера
│   └── routes.ts             # Определения маршрутов
├── services/
│   ├── db.ts                 # Слой работы с IndexedDB (сессии, сообщения, настройки)
│   └── llmProvider.ts        # OpenAI-совместимый SSE-стриминговый клиент
└── stores/
    ├── chatStore.ts           # Pinia-стор чата (сессии, сообщения, стриминг)
    └── settingsStore.ts       # Pinia-стор настроек (API-ключ, endpoint, модель, тема)
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

Ключи: `endpoint`, `apiKey`, `model`, `darkMode`

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
- Кнопка **«New chat»** — создаёт новую сессию и переключается на неё
- Список сессий с активным highlight (`chatgpt-session--active`)
- Контекстное меню (три точки): **Rename** / **Delete**
- Диалог переименования

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
```

### [`SettingsDialog.vue`](src/components/SettingsDialog.vue)

Модальный диалог настроек API (открывается из меню в header):
- **API Endpoint** — базовый URL (по умолчанию `https://api.deepseek.com/v1`)
- **API Key** — поле с возможностью показать/скрыть (кнопка `visibility`)
- **Model** — название модели (по умолчанию `deepseek-chat`)
- **Save** — сохраняет все три поля в IndexedDB через `settingsStore`
- **Валидация**: endpoint и model обязательны

---

## 6. Layout и страницы

### [`MainLayout.vue`](src/layouts/MainLayout.vue)

Корневой layout приложения:
- **Header** с кнопкой меню (бургер), заголовком «ChatGPT» и кнопкой шестерёнки
- **Шестерёнка** → `q-menu` с двумя пунктами:
  - «API Settings» → открывает `SettingsDialog`
  - «Dark Mode» / «Light Mode» → переключает тему через `settingsStore.toggleDarkMode()`
- **Sidebar** (`q-drawer`) — содержит `SessionList`
- Проблема с `@click` на кнопке шестерёнки **исправлена**: `q-menu` управляет своим состоянием через `v-model`, дополнительный `@click` конфликтовал и блокировал открытие меню

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
  - Кнопка **Edit** на последнем сообщении пользователя (только когда нет стриминга)
- **Режим редактирования**: `q-input` (textarea), кнопки Cancel и «Save & Submit», Ctrl+Enter для отправки
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

| State | Тип | По умолчанию | Описание |
|-------|-----|-------------|----------|
| `endpoint` | `Ref<string>` | `https://api.deepseek.com/v1` | Базовый URL API |
| `apiKey` | `Ref<string>` | `''` | API-ключ |
| `model` | `Ref<string>` | `deepseek-chat` | Название модели |
| `darkMode` | `Ref<boolean>` | `false` | Тёмная тема |

| Action | Описание |
|--------|----------|
| `load()` | Однократная загрузка из IndexedDB, применение `Dark.set()` |
| `saveEndpoint(val)` | Сохранение endpoint |
| `saveApiKey(val)` | Сохранение API-ключа |
| `saveModel(val)` | Сохранение модели |
| `toggleDarkMode()` | Переключение темы (Quasar Dark plugin + IndexedDB) |

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
