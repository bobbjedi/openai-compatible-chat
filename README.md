# openai-compatible-chat

> Web-only ChatGPT-like SPA built with Quasar/Vue 3. Works with DeepSeek, OpenAI, and any API supporting chat/completions. All data is stored **exclusively in your browser** (IndexedDB) — no backend, no server, no cloud sync.

[![Quasar](https://img.shields.io/badge/Quasar-2.14-1976D2?logo=quasar)](https://quasar.dev/)
[![Vue](https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Pinia](https://img.shields.io/badge/Pinia-2-yellow?logo=pinia)](https://pinia.vuejs.org/)
[![GitHub Pages](https://img.shields.io/badge/demo-online-10a37f?logo=github)](https://bobbjedi.github.io/openai-compatible-chat/)

---

## Features

- **SSE streaming** — real-time token-by-token responses via OpenAI-compatible `/chat/completions` endpoint
- **Voice input** — Web Speech API with automatic language detection (multilingual)
- **File attachments** — attach any text file (code, logs, configs) or images (PNG/JPEG/GIF/WebP) with Vision API support
- **Web search** — Tavily Search API integration with automatic tool-call loop (up to 3 rounds)
- **Rolling summary** — automatic periodic summarization to preserve context in long conversations
- **User Facts** — LLM-extracted knowledge base about the user, persistent across sessions
- **System prompt** — per-chat instructions with file import support (`.txt`)
- **Dark / Light theme** — theme persisted in `localStorage`, applied before app render (no flash)
- **IndexedDB persistence** — all chats, messages, and settings survive page reloads
- **Markdown rendering** — `marked` + `DOMPurify` for safe, formatted assistant responses
- **Message editing** — edit any user message, truncate follow-ups, and re-stream the answer
- **Context trimming** — token-aware message pruning to fit within configurable limits (up to 2M tokens)
- **ChatGPT-style UI** — pill-shaped input, collapsible sidebar, session rename/delete, copy-to-clipboard
- **Multi-model support** — select from preset DeepSeek models or enter any custom model name
- **PWA ready** — installable as a standalone app with generated icons

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Quasar 2.14 (SPA, webpack) |
| UI | Vue 3 (Composition API) |
| Language | TypeScript 4.5 |
| State | Pinia 2 |
| Storage | IndexedDB via `idb` 8 |
| Markdown | marked 11 + DOMPurify |
| Styling | Sass (SCSS) |
| Routing | Vue Router 4 |
| Icons | Material Icons |
| PWA icons | sharp (SVG → PNG) |

---

## Quick Start

```bash
# Clone the repository
git clone git@github.com:bobbjedi/openai-compatible-chat.git
cd openai-compatible-chat

# Install dependencies
yarn

# Start development server
npx quasar dev
```

App opens at `http://localhost:8080`.

### Live Demo

**[bobbjedi.github.io/openai-compatible-chat](https://bobbjedi.github.io/openai-compatible-chat/)** — deployed via GitHub Pages + GitHub Actions (PWA, HTTPS).

---

## Configuration

Click **Settings** (gear icon in the sidebar footer) to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| API Endpoint | `https://api.deepseek.com/v1` | Base URL of any OpenAI-compatible API |
| API Key | *(empty)* | Your provider's API key |
| Model | `deepseek-chat` | Model name (preset or custom) |
| Summary Model | `deepseek-chat` | Model used for generating summaries |
| Token Limit | 200 000 | Max context tokens (1000–2 000 000) |
| Vision Enabled | off | Enable image attachments for Vision API |
| Vision Model | `deepseek-chat` | Model used for image recognition |
| Web Search | off | Enable Tavily web search |
| Tavily API Key | *(empty)* | API key from [tavily.com](https://tavily.com) |

All settings are persisted in **IndexedDB** and survive page reloads.

---

## Key Features

### Voice Input

Click the microphone button in the input field to dictate text. Uses Web Speech API with multi-source language detection:

1. `navigator.languages` — browser preferences
2. `Intl.DateTimeFormat().resolvedOptions().locale` — OS locale
3. `navigator.language` — browser UI language

First locale starting with `ru` → Russian, otherwise English. Button pulses red while recording.

### File Attachments & Vision

Click the **📎** button to attach files. All text-based files are read as UTF-8 and sent to the LLM as context. Images (PNG, JPEG, GIF, WebP) are converted to base64 data URLs and sent via the Vision API when enabled.

File chips appear above the input field — removable before sending. In messages, files are shown as compact chips with type icons and sizes.

### Web Search (Tavily)

When enabled, the model can search the web for up-to-date information. The model responds with a strict JSON tool call `{"search":"query"}`, which triggers a Tavily API search. Results are injected into the context, and the model produces a final answer. Up to 3 search rounds per message.

### Rolling Summary (`maybeSummarize`)

Triggered every **20** user/assistant messages. The LLM receives the previous summary + last 20 messages and produces an updated summary (≤500 words). The summary is injected as a system message into subsequent requests, preserving context without growing token usage.

Toggle per chat in **Chat Settings** (gear icon in header, then **Auto Summary** switch).

### User Facts

During each summarization, the LLM also extracts facts about the user (preferences, projects, technologies, etc.). Facts are merged into a **global knowledge base** that persists across all chat sessions. A yellow banner notifies when new facts are discovered → **Show** opens the facts editor.

Manage facts manually via the **User Facts** button in the header.

### System Prompt

Open **Chat Settings** (gear icon in header) to set a per-chat system prompt. The prompt is placed first in every API request for that session. Import prompts from `.txt` files.

---

## Project Structure

```
src/
├── components/
│   ├── ChatInput.vue            # Message input + voice + file attachments
│   ├── SessionList.vue          # Sidebar session list + settings
│   ├── SettingsDialog.vue       # Global API settings (model, vision, search)
│   └── ChatSettingsDialog.vue   # Per-chat settings (system prompt, auto summary)
├── css/
│   └── app.scss                 # Global styles (light + dark themes, ~1070 lines)
├── layouts/
│   └── MainLayout.vue           # Root layout (header, sidebar, dialogs)
├── pages/
│   └── ChatPage.vue             # Main chat page (messages, streaming, editing, facts)
├── services/
│   ├── db.ts                    # IndexedDB layer (sessions, messages, settings)
│   ├── llmProvider.ts           # OpenAI-compatible SSE streaming client (supports image_url)
│   ├── searchProvider.ts        # Tavily Search API client
│   └── fileParser.ts            # File parser (text + image base64)
└── stores/
    ├── chatStore.ts             # Chat state (sessions, messages, streaming, summary, facts, tool-loop)
    └── settingsStore.ts         # Settings (endpoint, apiKey, model, vision, search, theme)
```

Full technical documentation: [`quasar-deepseek-chat.md`](quasar-deepseek-chat.md)

---

## Commands

```bash
yarn              # Install dependencies
npx quasar dev    # Development server (hot reload)
npx quasar build  # Production build (SPA)
yarn lint         # Run ESLint
yarn generate-icons  # Regenerate PWA icons from favicon.svg
```

---

## License

MIT
