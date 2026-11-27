# VideoVue

Protected videos for Bibix. An admin uploads a video on the **VideoVue** page inside Bibix
and gets a share link (`https://<bibix>/watch/<secret>`). The link plays the video **only
when the viewer has the VideoVue Chrome extension installed**. Viewers do not sign in and
cannot see any other video, only the one they were given a link to.

## How it works
1. **Upload** (Bibix → VideoVue, admin only). ffmpeg transcodes the file to HLS and encrypts
   every segment with a per-video AES-128 key. The original is deleted. Each video gets a
   random share token; the link can be regenerated (old link dies) or disabled.
2. **Watch page** `videos-watch/index.html`, served at `/watch/<share>`. It shows the title and
   thumbnail, then asks the extension for a *play token* through `window.postMessage`. No
   extension → "Install the VideoVue extension" box.
3. **Extension** (`extension-video/`). A content script on `/watch/*` pages relays the request
   to the background worker, which calls `POST /api/videos/watch/<share>/play-token`. That
   request carries `Origin: chrome-extension://<id>`, which is the server's gate (optionally
   pinned to `VIDEO_EXTENSION_IDS`). The token is a 15-minute JWT bound to that one video,
   refreshed while playing.
4. **Streaming.** Playlist, key and segments are served only with a valid play token
   (`Authorization: Bearer …`, added by hls.js). Every first play is logged with IP, user
   agent and extension id (visible in the VideoVue page, eye icon).

**Not DRM.** With the extension installed a viewer can still screen-record or pull the key
with DevTools. This stops links from working without the extension; it does not make the
video uncopyable.

## Server
- Routes: `backend/src/routes/videos.js`, mounted at `/api/videos`.
- Storage: `backend/data/videos/<id>/{hls/, key.bin, thumb.jpg}`.
- Needs **ffmpeg** (`FFMPEG_PATH` env, or the `ffmpeg-static` optional dependency as a fallback).
- Env (optional): `VIDEO_EXTENSION_IDS=abc…,def…` allow-list; `VIDEO_MAX_UPLOAD_MB` (2048);
  `VIDEO_PLAY_TOKEN_TTL` seconds (900); `VIDEO_ALLOW_NO_EXTENSION=1` dev only.
- Share links use the host the admin is browsing on.

## Install the extension (unpacked, until it is on the Web Store)
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension-video/` folder.
3. Open a `/watch/…` link. Nothing to configure.

To pin the server to your build only, copy the ID from `chrome://extensions` into
`VIDEO_EXTENSION_IDS` in `backend/.env` and restart. A Web Store build has a stable ID;
an unpacked folder's ID depends on its path.

## Files
- `manifest.json` — content script on `http://localhost:3001/watch/*` and `https://*/watch/*`.
- `content/content.js` — page ↔ extension bridge (only on pages with `<meta name="bibix-video">`).
- `background.js` — fetches play tokens; only for its own content script on a `/watch/<share>` URL of the same origin.
- `popup/` — informational popup.
- `generate-icons.js` — regenerates the icons (`node generate-icons.js`).
