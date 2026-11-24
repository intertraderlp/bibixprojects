# Bibix Chats — WhatsApp (linked device) + Telegram, with AI translation, as an installable PWA

Open **`/chats/`** on the Bibix host (sidebar → *Chats* shows it inside the Bibix app; `/chats/`
directly is the standalone PWA — install it on the phone from the browser's *Add to Home Screen*).
It links the user's **own WhatsApp account as a linked device** — the same protocol WhatsApp Web
uses — and/or **Telegram accounts** through the official client API, and gives a chat UI with the
translation features of the `extension-chat-ai/` Chrome extension built in. Several accounts per
user (any mix of WhatsApp and Telegram); the account picker is at the top of the chat list.

> ## ⚠️ Read this before linking a number
> Bibix Chats is **not an official WhatsApp client**. It uses [Baileys](https://github.com/WhiskeySockets/Baileys),
> a reverse-engineered implementation of the WhatsApp Web protocol. Using it is **against WhatsApp's
> Terms of Service** and WhatsApp **can temporarily or permanently ban the number** you link, without
> warning. Test with a **secondary number** first, never use it for bulk, automated or marketing
> messaging, and expect to re-link if WhatsApp changes the protocol. The same warning is shown in the
> link dialog in the UI.

## What it does
| Feature | Where |
|---|---|
| Link WhatsApp by **QR** (scan from the phone) or by **pairing code** ("Link with phone number instead" — needed when the PWA runs on the *same* phone) | ＋ → WhatsApp |
| Appears on the phone under *Linked devices* as **Chrome (Bibix)** (`CHATS_WA_BROWSER` to change) | — |
| Link **Telegram**: phone number → login code (sent to the other Telegram app / SMS) → 2FA password if set. Shows under Telegram → Settings → Devices as **Bibix Chats** | ＋ → Telegram |
| **Reply** (quote), **Forward** to up to 20 chats (media is forwarded when the message is still cached, otherwise as text), copy, quote in draft — tap a bubble | message menu |
| **📞** in the thread header: open the chat in the real WhatsApp/Telegram app to call, dial the number, or **Live captions** (microphone → speech-to-text → translation) | thread header |
| Incoming WhatsApp calls appear as call-log lines (and a push "answer it on your phone") | thread |
| Accounts: add, rename, **Unlink** (logs out on the phone) or **Remove** (Bibix only) | Settings → Accounts |
| Notifications: never for archived or muted chats (optional), groups optional | Settings |
| Chat list with unread counts, last message, pinned/archived, per-chat language chip | left pane |
| Thread with day separators, read ticks, quoted messages, media placeholders, "Load earlier" (local) and **Older…** (asks the phone for history) | right pane |
| **Send in `<language>`** per chat, remembered; **auto-detected** from incoming messages unless you chose one (dashed chip / green select) | toolbar |
| **Translate & send** (Enter), **Translate** (review in the box, then Enter), **Undo**, **Send as typed** | composer |
| Incoming messages translated inline into *my language* (per-chat toggle; the last N translated when a chat opens; "Translate visible") | toolbar |
| 🌐 on any bubble: translate on demand / hide | hover a bubble |
| "**you wrote**" under translated outgoing bubbles | thread |
| **⚡ Quick answers**: groups of canned replies; click = insert to edit, second click / ➤ = translate & send | composer + Settings |
| Live updates (new messages, status, translations) over the app's SSE stream; **web push** when no tab is open; app badge with unread count | — |
| Style instructions, provider/model choice per user | Settings |

**Calls are not carried by Bibix.** A WhatsApp linked device never receives the call audio (calls are
end-to-end between the phones) and Telegram calls likewise need the official app, so "call" opens the
real app (`wa.me/<number>`, `tg://user?id=…`) or dials the number (`tel:`). *Live captions* is the
extension's call-captions feature done with the microphone instead of a page hook: put the call on
speaker and the PWA transcribes what it hears (Groq Whisper / OpenAI, keys from AI providers) and
translates it into your language. Listen-only; nothing is injected into the call.

AI keys are the ones in **Bibix → Settings → AI providers** (`user_ai_providers`), used server-side;
nothing is sent from the browser to a provider. Env keys (`GROQ_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, …) are a fallback. Default models for chats: Groq `openai/gpt-oss-120b`,
OpenAI `gpt-4o-mini`, Gemini `gemini-2.5-flash` (see `translate.js`). The prompt is the extension's
`buildSystemPrompt` with the `LANG:` first-line detection.

## Telegram setup
Telegram's client API needs an **API id + API hash** (free): log in at https://my.telegram.org/apps,
create an application (any name/platform), copy the two values. Either put them on the server —
```
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```
in `backend/.env` (both the app and the worker read it) — or each user pastes their own pair in
Chats → Settings → Accounts (stored in their chat settings). The MTProto session string is kept in
`backend/data/chats/<userId>/<accountId>/telegram.session`; `meta.json` next to it carries the
platform (and the api id/hash) so the worker resumes it at boot. Library: `teleproto` (maintained
fork of GramJS). Unlinking calls `auth.logOut`, which also removes the device from the phone's list.

## Layout
```
backend/src/chats/sessionManager.js   Router over the platform drivers; resumeAll() reads each account's meta.json.
backend/src/chats/whatsapp.js         Baileys sockets: auth state on disk, reconnect/backoff, QR + pairing code,
                                      quote/forward (raw message cache), call signalling, normalises events → onEvent(). No DB access.
backend/src/chats/telegram.js         teleproto client per account: phone/code/password login gates, dialogs + history,
                                      new messages, read receipts, typing; same normalised events.
backend/src/chats/worker.js           Optional separate always-on process exposing the manager on 127.0.0.1:3002
                                      and POSTing events to the app (/api/chats/internal/events) with a retry queue.
backend/src/chats/client.js           App-side handle: in-process manager (dev) or HTTP proxy to the worker (prod).
backend/src/chats/store.js            SQLite tables chat_accounts, chat_contacts, chat_chats, chat_messages,
                                      chat_user_settings, chat_quick_answers (all in monday.db).
backend/src/chats/translate.js        Provider resolution + translation with LRU cache; speech-to-text for live captions.
backend/src/routes/chats.js           REST API (see header comment) + event handling → DB + SSE + push.
backend/scripts/chats-worker.sh       start/stop/status/restart for the worker; cron-friendly.
chats/                                The PWA: index.html, app.js, style.css, sw.js, manifest.json, icons.
frontend/src/pages/ChatsPage.tsx      The same PWA embedded (iframe, ?embed=1) at /chats inside the Bibix app shell.
```
Auth state: `backend/data/chats/<userId>/<accountId>/` (`creds.json`, keys, `meta.json`). Deleting the
folder = the device must be re-linked. `backend/data/` is git-ignored.

## Running locally
```
cd backend && npm install
node src/index.js            # in-process mode: Baileys runs inside the web process
open http://localhost:3001/chats/
```
No extra env is needed in dev. Put at least one AI key in Bibix settings (or `GROQ_API_KEY` in `.env`).

## Deploying (NameHero / LiteSpeed lsnode) — use the worker

**One-liner (cPanel terminal, production):** after `main` is pushed,
```
git -C ~/bibixprojects fetch origin main && git -C ~/bibixprojects show FETCH_HEAD:backend/scripts/chats-deploy.sh > /tmp/chats-deploy.sh && bash /tmp/chats-deploy.sh
```
`backend/scripts/chats-deploy.sh` does steps 1–5 below (fast-forward, npm install, env, worker + cron, app restart) and prints health checks. For staging prefix it with `ROOT=$HOME/bibixprojects-staging APP_URL=https://staging.bibix.ailabstech.com BRANCH=staging WORKER_PORT=3003`. The manual steps:
Baileys needs **one long-lived Node process** holding the WebSocket to WhatsApp. On LiteSpeed the
web app runs as `lsnode:` workers that are killed on idle, restarted on deploy and **duplicated**
when the event loop blocks (see the lsnode notes in the deployment memory). Two processes holding
the same session make WhatsApp close one of them (code 440, "replaced") and the phone shows
disconnects. So in production the sessions run in the **worker process** and the web app only
talks to it over localhost — same pattern as the AI Love app on port 3001.

1. **Deploy the branch** as usual (staging: `git fetch && git reset --hard origin/<branch>`), then
   `cd backend && npm install --omit=dev` — this adds `@whiskeysockets/baileys`, `qrcode`,
   `@hapi/boom`, `pino`, `teleproto` (Node ≥ 20 required; the server has Node 20).
2. **`backend/.env`** (both the web app and the worker read it):
   ```
   CHATS_WORKER_URL=http://127.0.0.1:3002      # web app → proxy everything to the worker
   CHATS_WORKER_PORT=3002                      # worker listens here (127.0.0.1 only)
   CHATS_INTERNAL_SECRET=<long random string>  # shared by both; required
   CHATS_APP_URL=http://127.0.0.1:<app port>   # worker → app event delivery (the lsnode app's local port;
                                               # or the public URL https://staging.bibix.ailabstech.com if
                                               # the app has no fixed local port)
   # optional
   CHATS_WA_BROWSER=Bibix,Chrome,1.0.0         # what the phone shows under Linked devices
   CHATS_AUTH_DIR=/home/<user>/bibixprojects-staging/backend/data/chats
   CHATS_LOG_LEVEL=warn
   TELEGRAM_API_ID=…                           # see "Telegram setup" (or users paste their own in Settings)
   TELEGRAM_API_HASH=…
   ```
   Pick a free port per environment (e.g. 3002 staging, 3003 production) — staging and production
   each run their own worker and their own `.env`.
3. **Start the worker and keep it alive** (cPanel terminal):
   ```
   bash ~/bibixprojects-staging/backend/scripts/chats-worker.sh
   bash ~/bibixprojects-staging/backend/scripts/chats-worker.sh status
   ```
   Add to crontab (`crontab -e`) so it survives reboots and crashes:
   ```
   */2 * * * * bash $HOME/bibixprojects-staging/backend/scripts/chats-worker.sh >/dev/null 2>&1
   @reboot     bash $HOME/bibixprojects-staging/backend/scripts/chats-worker.sh >/dev/null 2>&1
   ```
   Logs: `backend/data/chats-worker.log`.
4. **Restart the web app** (kill the lsnode pid or cPanel → Setup Node.js App → Restart) so it picks
   up the new env and routes. `GET /api/chats/meta` (logged in) returns `"mode":"worker"` and the
   worker's health when everything is wired.
5. After a **code update** touching `backend/src/chats/`: `chats-worker.sh restart` (the web app
   restart does not restart the worker). Sessions resume from disk without a new QR.

Why no reverse proxy rule: the browser never talks to the worker; only the app does, over
127.0.0.1. Nothing in `.htaccess` changes. The worker never opens `monday.db` (single-writer rule
for `node-sqlite3-wasm`), so it cannot corrupt the database even when lsnode duplicates the app.

Event delivery when the app is down: the worker queues events (up to 5000) and retries with
backoff, so messages received during a web-app restart are stored once it is back.

## Operating notes
- **Status values** on an account: `unlinked → qr → connecting → open`; `stopped` (disconnected on
  purpose), `logged_out` (removed on the phone; auth wiped), `replaced` (another process opened the
  session — the duplicate-worker symptom; fix the deployment, then *Reconnect*).
- History: Baileys delivers the recent history on link (`syncFullHistory: false`). Older messages of
  a chat come through **Older…** (on-demand sync from the phone), which needs the phone online.
- The device stays linked while the worker runs; WhatsApp unlinks devices that have been offline
  for ~14 days.
- `markOnlineOnConnect` is off so the phone keeps showing notifications.
- Unlinking in Settings → Accounts logs the device out on the phone and deletes the synced
  chats/messages from Bibix.
- Push notifications reuse the app's VAPID keys (`/api/push/subscribe`); the Chats service worker
  (`chats/sw.js`) shows them when no Chats tab is focused and opens the right chat on tap.
- Tables are `chat_*`; nothing else in the schema changed. `aiProviders.generateText` gained optional
  `system` and `temperature` params (backwards compatible).

## Message ids
WhatsApp message ids are the WA ids; Telegram ids are per peer, so `msg_id` is `"<jid>:<id>"` with
`jid = "<markedPeerId>@tg"`. Call-log lines are `"call:<callId>"`.
