# Bibix Idealista Scraper

A standalone Chrome extension (Manifest V3) that scrapes idealista listings and sends
them to a board in your Bibix workspace.

## What it captures per listing
Link, Title (→ item name), Price, €/m², Rooms, Size m², Address, Area (barrio),
Zone (search district, from the page/URL), City, Phone (optional), Description.

It **walks every result page** automatically (clicks "Siguiente" / loads the next page
until there are none) and **dedupes by Link** — re-running updates existing rows instead
of creating duplicates.

## Column mapping
The backend maps onto a board's **existing columns by name or alias** (case-insensitive),
so a curated board with `Bed Rooms`, `Size m2`, `Short Description`, `Phone Number`, `Link`,
`Price` is filled in place. Any field with no matching column gets a new column created
(reported back in the popup). Aliases live in `SCRAPER_COLUMNS` in
`backend/src/routes/scraper.js`.

## Install (unpacked)
1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension-idealista/` folder.
3. Click the extension icon → set **Bibix URL** (default `http://localhost:3001`) → sign in.

## Use
1. Open an idealista **search results** page (e.g. the Moncloa, Madrid list).
2. Click the extension icon → pick the **destination board**.
3. (Optional) tick **Reveal phone numbers** — slower and more block-prone.
4. Set **Max pages** (`0` = all) → **Scrape all pages → board**.
5. Watch the on-page pill + popup counters. A floating pill shows progress; the tab
   advances page by page.

## Notes / limits
- **Anti-bot:** idealista uses DataDome. Walking all pages (especially with phone reveal)
  can trigger a CAPTCHA. The scraper self-throttles with random delays and **stops cleanly
  and reports** when it detects a block — solve the CAPTCHA in the tab, then start again.
- **Selectors** can break when idealista changes its markup. All card selectors and the
  phone-reveal / next-page logic are in `content/content.js`, written with fallbacks — that's
  the place to adjust if a field starts coming back empty.
- idealista's Terms restrict scraping; use responsibly.

## Backend
Endpoint: `POST /api/scraper/ingest` (auth: Bearer JWT from `/api/auth/login`).
Body: `{ board_id, source, group_name?, rows: [...] }`. Added in
`backend/src/routes/scraper.js` and mounted in `backend/src/index.js` with extension CORS.
