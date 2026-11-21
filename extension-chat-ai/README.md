# Bibix Chat AI — WhatsApp Web & Telegram Web translator

A standalone Chrome extension (Manifest V3) that adds an AI toolbar to **WhatsApp Web**
and **Telegram Web** (both the `/k/` and `/a/` clients).

**Feature 1 — live translation**
- Type in your language → the draft is translated into the chat's language and sent.
- Incoming messages get an inline translation (into your language) under each bubble.
- Under your own sent bubbles you can see what you originally typed.
- Target language is remembered **per chat** (Maria in Spanish, Yuki in Japanese…).

**Providers** (pick one, paste a key): Groq (free), Google Gemini (free tier), Mistral (free tier),
OpenRouter (free models), Ollama (local, free), OpenAI, Anthropic Claude, xAI Grok, Moonshot Kimi,
DeepSeek, or any custom OpenAI-compatible endpoint. Keys live only in `chrome.storage.local`
and are sent only to the chosen provider, from the background worker.

## Install (unpacked)
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension-chat-ai/` folder.
3. The settings page opens: set **My language**, **Send messages in**, pick a provider, paste the
   key, click **Test translation**. (Groq is a good free start: https://console.groq.com/keys)
4. Open https://web.whatsapp.com or https://web.telegram.org — a teal toolbar appears above the composer.

## Use
| Action | How |
|---|---|
| Send a translated message | Type your draft → **Translate & send** (or `Ctrl/⌘+Shift+Enter`) |
| Review before sending | **Translate** (or `Ctrl/⌘+Shift+T`) replaces the draft with the translation; press Enter to send. **Undo** / `Ctrl/⌘+Shift+U` restores your text |
| Change this chat's language | Edit the **Send in** box in the toolbar (saved per chat). Recently used languages are listed first |
| Automatic per-chat language | The first incoming message in a chat is language-detected; if you never set a language for that chat, it becomes the chat's **Send in** language (box turns green). Type a language to override; your choice always wins |
| Translate one message on demand | Hover a bubble and click the **🌐** icon at the end of its text (any bubble, incoming or outgoing, older ones too; click again to hide). Chrome's right-click menu also has **Translate this message** / **Translate selected text**, but WhatsApp/Telegram replace the native menu on bubbles — hold **Shift** while right-clicking to get Chrome's menu |
| Incoming translations | Tick **Incoming → <my language>**. New messages are translated as they arrive; on opening a chat the last N (default 15, see settings) are translated |
| Translate older messages | **Translate visible** (also in the popup) |
| Pause everything | The toggle in the toolbar or the popup |

Settings → **Style instructions** lets you steer tone ("informal, use tú", "business formal", "short").

## Layout
```
manifest.json         MV3; content script on web.whatsapp.com + web.telegram.org
providers.js          provider registry (base URL, default model, kind: openai|anthropic|gemini), languages, default settings
background.js         service worker: settings, provider HTTP calls, translation cache, model listing
content/content.js    platform adapters (selectors), toolbar, draft translate/send, incoming observer
options/              full settings page (provider keys, models with "fetch models", defaults, shortcuts)
popup/                quick switches for the current chat
generate-icons.js     node generate-icons.js → icons/*.png
```

## Adding a provider
Add one entry to `BX_PROVIDERS` in `providers.js`. Anything with a `/chat/completions` endpoint is
`kind: 'openai'`; the worker already handles `anthropic` and `gemini` wire formats.

## Notes / limits
- **Selectors** break when WhatsApp/Telegram change their markup. Everything DOM-specific is in the
  `adapters` object at the top of `content/content.js` — adjust there. WhatsApp (Nov 2026) no longer
  has `#main` or `.message-in/.message-out`; bubbles are found by their text containers and
  incoming/outgoing is decided by which side of the pane they sit on. The draft is written with
  insertText → paste → DOM fallbacks and read back before sending.
- **Verified:** WhatsApp Web (2026-11-21). Telegram Web K/A adapters are written but not yet tested.
- **Ollama** must allow the extension origin: `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`.
- A **custom** base URL outside the listed hosts triggers a one-time host-permission prompt on save.
- Translations are cached (per text + language + provider) so re-renders don't cost tokens.
- Incoming translations ask the model for the source language on the first line (`LANG: Hebrew`), which
  drives the per-chat language memory in `settings.perChat[platform|chatTitle]`.
- Media captions, polls and forwarded cards are translated only if their text is inside the normal
  message text element; voice notes/images without text are skipped.

## Roadmap (next functionalities)
Reply suggestions / draft with AI, summarize a long chat, tone rewrite, canned answers, auto-reply rules.
