# Bibix Instagram Extension

Chrome extension for Instagram engagement (likes, replies, follows, DMs),
follower snapshots, scheduled posts and profile research — synced to the
Bibix backend. This folder is the single source of truth; the version is in
`manifest.json`.

## Install once (per machine)

1. Clone or pull this repo (`git clone https://github.com/gpessah/bibixprojects`).
2. Chrome → `chrome://extensions/` → **Developer mode** on (top-right).
3. **Load unpacked** → select this folder (`extensions/instagram/`).
4. If an older copy of "Instagram Extension" from another folder is still
   listed, **Remove** it first — two copies fight over the same Instagram tab.
5. Pin the icon (puzzle piece → pin).

## Connect to Bibix

1. Bibix → **Settings → Instagram Extension** → **Copy** the token
   (production: `bibix.ailabstech.com`, staging: `staging.bibix.ailabstech.com`).
2. Extension popup → **📡 Sync** → paste into **Production** (or enable
   *Also sync to Staging* and paste there) → **Connect**.
3. The row now reads `Connected as <name> (<email>) ✓` — that is the Bibix
   user this browser acts as. `❌ Token rejected` means the token was
   regenerated in Settings; paste the current one.

## Updating to a new version

```bash
cd <path-to-your-clone>
git pull
```

Then `chrome://extensions/` → find "Instagram Extension" → click ↻ **reload**.
The card shows the new version from `manifest.json`. No re-installing.

## Files

| File              | Role |
|-------------------|------|
| `manifest.json`   | Metadata + permissions. Bump `version` on every release. |
| `popup.html/js`   | Popup UI: engagement actions, accounts, schedule, Sync (tokens). |
| `content.js`      | Runs on instagram.com — likes, replies, follows, scans, scheduling. |
| `background.js`   | Service worker: token storage, backend calls, batch queue, watchdog. |
| `fetch-hook.js`   | Page-context hook that reads Instagram's own API responses. |
| `dashboard.*`, `history.*`, `campaigns.*` | Extension-side pages opened from the popup. |

## Changelog (recent)

* **1.52.0** — DM auto-replies hold a real conversation: "Reply Unread DMs"
  reads the recent thread (last ~14 messages) and generates the next reply via
  your configured **default AI provider** (Settings → AI providers) — no more
  separate Groq key / random canned fallbacks. Continues naturally in the other
  person's language, doesn't re-greet, varies wording.
* **1.51.0** — correct stop-reason + capture IG's real load-more control:
  distinguish "Couldn't load more" (loader couldn't page past the first set)
  from "Not enough comments" (loaded pages, then ran out); record the real
  on-page control names so the loader selector can be fixed precisely.
* **1.50.0** — gentle one-page-at-a-time loading (per request): like every
  comment on the current page one by one, then click the ⊕ once to load the
  next page, like those, and so on — no up-front multi-scroll. Clean stop-reason
  codes (target_reached / not_enough_comments / no_comments_found /
  rate_limited / stopped_by_user) recorded per run, surfaced as a **Result**
  column in the dashboard so you can see why a request didn't finish.
* **1.49.0** — big like-throughput fix: stop hovering each comment's profile
  before liking. IG's hover card can take up to 6s to appear (or never, in a
  throttled tab), and that per-like cost — purely to capture a follower number
  the backend can backfill anyway — was why large like runs died at 30–50
  before finishing. Also records a compact per-run diagnosis to the campaign
  (loaded comments, load-more buttons seen, scroll-container found, failed
  likes, elapsed minutes, stop reason) so the cause of any short run is
  visible server-side without DevTools.
* **1.48.0** — likes still capping around ~50 on comment-heavy posts: harden
  the comment loader (broader "load more" matcher incl. the ⊕ icon and
  "view/show more" variants; scroll the nested container AND the window AND the
  last comment into view + a wheel event; treat panel scrollHeight growth as
  progress). Adds a **version stamp** in the console (`content.js vX.Y.Z
  loaded`) to end folder/version confusion, and a plain-English end-of-run line
  in the popup that says whether it ran out of loadable comments or Instagram
  rejected the likes (rate-limit), plus a `[BibixCS]` DOM snapshot on the
  console for diagnosis.
* **1.47.0** — AI replies now actually read each comment: extract just the
  comment body (not username/timestamp/“Reply”/like-count), pass the
  commenter's handle, and the backend prompt answers the comment's specific
  content in its own language instead of a generic line. Turn on the **AI
  Replies** toggle and set a default provider in Monday → Settings → AI
  providers.
* **1.46.0** — fix likes/replies stopping far short of the request on
  comment-heavy posts (e.g. 42/200 on a 286-comment post): the incremental
  loader is now persistent — it keeps clicking "load more" and scrolling until
  new comments actually appear, and only declares the post exhausted after a
  sustained stretch with no button and no growth. Still stops the moment the
  target is reached, so memory stays bounded.
* **1.45.0** — likes/replies load comments incrementally: act on what is on
  screen, click ⊕ "load more" only when out of candidates, stop loading when
  the target is reached (faster start, far less memory than pre-loading 2×).
* **1.44.0** — Sync section shows `Connected as <name> (<email>)` and flags
  rejected tokens on every popup open.
