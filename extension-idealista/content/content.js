// Bibix Idealista Scraper — content script.
// Runs on idealista result pages. On request from the background worker it scrapes
// every listing card on the current page (optionally revealing phones, throttled),
// finds the "next page" URL, and reports back. The worker then navigates the tab
// to the next page, which reloads this script — so each run handles ONE page.
//
// ⚠️ SELECTORS: idealista changes its markup periodically. All the card selectors
// live in CARD_SELECTORS / field getters below and are written with fallbacks —
// if a field starts coming back empty, that's the place to adjust.

(() => {
  'use strict';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  // ── Status pill ────────────────────────────────────────────────────────────
  let pill;
  function showPill(text, kind = 'info') {
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'bibix-scraper-pill';
      document.documentElement.appendChild(pill);
    }
    pill.textContent = '🏠 ' + text;
    pill.dataset.kind = kind;
    pill.style.display = 'block';
  }
  function hidePill() { if (pill) pill.style.display = 'none'; }

  // ── CAPTCHA / DataDome detection ─────────────────────────────────────────────
  function isBlocked() {
    const t = (document.title || '').toLowerCase();
    if (t.includes('captcha') || t.includes('acceso denegado') || t.includes('access denied')) return true;
    if (document.querySelector('iframe[src*="captcha"], iframe[src*="datadome"], #px-captcha, .g-recaptcha, [id*="datadome"]')) return true;
    // idealista "parece que eres un robot" block page
    if (/parece que eres un robot|unusual traffic|detected unusual/i.test(document.body?.innerText || '')) return true;
    return false;
  }

  // ── Card discovery ───────────────────────────────────────────────────────────
  const CARD_SELECTORS = [
    'article.item',
    '.items-container article',
    '.item-multimedia-container ~ .item-info-container', // defensive
  ];
  function getCards() {
    for (const sel of CARD_SELECTORS) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length) return Array.from(nodes).filter(n => n.querySelector('a.item-link, a[href*="/inmueble/"]'));
    }
    return [];
  }

  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const qText = (root, sel) => txt(root.querySelector(sel));

  function absUrl(href) {
    if (!href) return null;
    try { return new URL(href, location.origin).href.split('#')[0]; } catch { return href; }
  }

  // ── Field extraction for one card ────────────────────────────────────────────
  function parseCard(card) {
    const linkEl = card.querySelector('a.item-link') || card.querySelector('a[href*="/inmueble/"]');
    const link = absUrl(linkEl && linkEl.getAttribute('href'));
    const title = txt(linkEl) || qText(card, '.item-link');

    const price = qText(card, '.item-price') || qText(card, '[class*="price"]');

    // €/m² — sometimes shown; otherwise computed later from price/size.
    let pricePerM2 = '';
    const allText = card.innerText || '';
    const ppm = allText.match(/([\d.,]+)\s*€\s*\/\s*m/i);
    if (ppm) pricePerM2 = ppm[1];

    // Details row: "3 hab.", "70 m²", "Bajo exterior con ascensor", ...
    const details = Array.from(card.querySelectorAll('.item-detail-char .item-detail, .item-detail'))
      .map(el => txt(el)).filter(Boolean);
    let rooms = '', size = '';
    for (const d of details) {
      if (/hab\.?|dormitor/i.test(d) && !rooms) rooms = (d.match(/\d+/) || [''])[0];
      else if (/m²|m2|\bm\b/i.test(d) && !size) size = (d.match(/[\d.,]+/) || [''])[0];
    }

    const description = qText(card, '.item-description p') || qText(card, '.item-description') || qText(card, '[class*="description"]');

    // Address / area parsed from the title: "Piso en Calle X, Barrio, Ciudad"
    let address = '', area = '';
    const m = title.match(/\ben\s+(.+)$/i);
    const locStr = m ? m[1] : title;
    const parts = locStr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) {
      address = parts[0];
      area = parts.length >= 3 ? parts[parts.length - 2] : (parts[1] || '');
    }

    // Compute €/m² if not present.
    if (!pricePerM2 && price && size) {
      const p = Number(String(price).replace(/[^\d]/g, ''));
      const s = Number(String(size).replace(/[^\d]/g, ''));
      if (p && s) pricePerM2 = String(Math.round(p / s));
    }

    return { link, title, price, price_per_m2: pricePerM2, rooms, size, address, area, description, phone: '' };
  }

  // ── Phone reveal (throttled, optional) ───────────────────────────────────────
  function findPhoneInCard(card) {
    const tel = card.querySelector('a[href^="tel:"]');
    if (tel) return tel.getAttribute('href').replace(/^tel:/, '').trim();
    // Revealed numbers often sit in a span after the click.
    const m = (card.innerText || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/);
    if (m) {
      const digits = m[0].replace(/[^\d+]/g, '');
      if (digits.replace(/\D/g, '').length >= 9) return m[0].trim();
    }
    return '';
  }

  async function revealPhone(card) {
    // Already visible?
    const existing = findPhoneInCard(card);
    if (existing) return existing;

    const btn = card.querySelector(
      'a[href*="phone"], button[class*="phone"], .icon-phone, ._btn-icon-phone, [class*="see-phone"], [class*="ver-telefono"]'
    ) || Array.from(card.querySelectorAll('a,button,span')).find(el => /ver\s*tel[eé]fono/i.test(el.textContent || ''));

    if (!btn) return '';
    try {
      btn.scrollIntoView({ block: 'center' });
      await sleep(rand(250, 600));
      btn.click();
    } catch { return ''; }

    // Wait for the number to appear.
    for (let i = 0; i < 12; i++) {
      await sleep(rand(250, 450));
      const found = findPhoneInCard(card);
      if (found) return found;
      if (isBlocked()) return '__BLOCKED__';
    }
    return '';
  }

  // ── Search context (main area + city) ────────────────────────────────────────
  function titleCaseSlug(slug) {
    return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  }
  // Prefer the page H1 ("23 casas y pisos en Moncloa, Madrid"); fall back to the
  // URL path (/venta-viviendas/madrid/moncloa/…), skipping filter segments.
  function getSearchContext() {
    let zone = '', city = '';
    const h1 = txt(document.querySelector('h1'));
    const m = h1.match(/\ben\s+(.+)$/i);
    if (m) {
      const parts = m[1].split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) { zone = parts[0]; city = parts[parts.length - 1]; }
      else if (parts.length === 1) { zone = parts[0]; }
    }
    if (!zone || !city) {
      // URL: first two segments after the listing-type segment are city then zone.
      const segs = location.pathname.split('/').filter(Boolean); // e.g. venta-viviendas, madrid, moncloa, con-precio…
      const clean = [];
      for (let i = 1; i < segs.length; i++) {
        const s = segs[i];
        if (/_|^(con|de|sin|desde|hasta)-/i.test(s) || /\.htm$/i.test(s)) break; // filter/paging segments
        clean.push(s);
      }
      if (!city && clean[0]) city = titleCaseSlug(clean[0]);
      if (!zone && clean.length) zone = titleCaseSlug(clean[clean.length - 1]);
    }
    return { zone, city };
  }

  // ── Next page URL ────────────────────────────────────────────────────────────
  function getNextUrl() {
    const sels = [
      '.pagination li.next a',
      '.pagination a.icon-arrow-right-after',
      'a[rel="next"]',
      '.pagination-next a',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.getAttribute('href')) return absUrl(el.getAttribute('href'));
    }
    // Fallback: a pagination link whose text is "Siguiente".
    const byText = Array.from(document.querySelectorAll('.pagination a, nav a'))
      .find(a => /siguiente/i.test(a.textContent || '') && a.getAttribute('href'));
    return byText ? absUrl(byText.getAttribute('href')) : null;
  }

  // ── Scrape one page ──────────────────────────────────────────────────────────
  async function scrapePage(revealPhones) {
    if (isBlocked()) {
      showPill('Blocked by idealista (CAPTCHA)', 'error');
      chrome.runtime.sendMessage({ type: 'BLOCKED' });
      return;
    }

    const cards = getCards();
    const ctx = getSearchContext();
    showPill(`Reading ${cards.length} listings…`, 'info');
    const rows = [];

    for (let i = 0; i < cards.length; i++) {
      const row = parseCard(cards[i]);
      row.zone = ctx.zone;
      row.city = ctx.city;
      if (revealPhones && row.link) {
        showPill(`Revealing phones ${i + 1}/${cards.length}…`, 'info');
        const phone = await revealPhone(cards[i]);
        if (phone === '__BLOCKED__') {
          chrome.runtime.sendMessage({ type: 'BLOCKED' });
          showPill('Blocked while revealing phones', 'error');
          return;
        }
        row.phone = phone || '';
        await sleep(rand(600, 1600)); // human-paced between cards
      }
      if (row.link) rows.push(row);
    }

    const nextUrl = getNextUrl();
    showPill(`Sending ${rows.length} listings…`, 'info');

    chrome.runtime.sendMessage(
      { type: 'PAGE_DONE', payload: { rows, nextUrl, page: location.href } },
      (resp) => {
        if (chrome.runtime.lastError) { showPill('Lost connection to Bibix', 'error'); return; }
        const d = resp && resp.data;
        if (d && d.done) { showPill('Scrape complete ✔', 'done'); setTimeout(hidePill, 4000); }
        else if (d && d.continue) { showPill('Loading next page…', 'info'); }
        else if (resp && resp.ok === false) { showPill('Error: ' + (resp.error || 'stopped'), 'error'); }
      }
    );
  }

  // ── Wire up ──────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'SCRAPE_PAGE') {
      scrapePage(!!msg.revealPhones);
      sendResponse({ ok: true });
    }
    return true;
  });

  // Announce readiness so the worker can resume a job after navigation.
  try { chrome.runtime.sendMessage({ type: 'CONTENT_READY' }); } catch (_) {}
})();
