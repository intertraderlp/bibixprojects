// Bibix LinkedIn AI Booster — content script
// Injects "✨ AI" buttons next to LinkedIn comment boxes, "Add your perspective"
// contribution prompts, and reply boxes. On click, generates text via the Monday
// backend and inserts it into the editor.

(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-bibix-processed';
  const BTN_CLASS = 'bibix-ai-btn';

  const ORPHANED_MSG = 'Extension was updated — please reload this LinkedIn tab (Cmd+R) and try again.';
  function send(type, payload) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage || !chrome.runtime.id) {
        return resolve({ ok: false, error: ORPHANED_MSG });
      }
      try {
        chrome.runtime.sendMessage({ type, payload }, (res) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message || '';
            if (/context invalidated|receiving end does not exist/i.test(msg)) {
              resolve({ ok: false, error: ORPHANED_MSG });
            } else resolve({ ok: false, error: msg });
          } else resolve(res);
        });
      } catch (e) {
        const msg = (e && e.message) || '';
        if (/sendMessage|invalidated|undefined/i.test(msg)) {
          resolve({ ok: false, error: ORPHANED_MSG });
        } else resolve({ ok: false, error: msg });
      }
    });
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const k in props) {
      if (k === 'style' && typeof props[k] === 'object') Object.assign(node.style, props[k]);
      else if (k === 'className') node.className = props[k];
      else if (k === 'onClick') node.addEventListener('click', props[k]);
      else if (k.startsWith('on') && typeof props[k] === 'function')
        node.addEventListener(k.slice(2).toLowerCase(), props[k]);
      else node.setAttribute(k, props[k]);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // ── Extract post info ────────────────────────────────────────────────────────
  function findPostContainer(node) {
    // Pass 1 — use closest() to find a known post wrapper. Stops at the
    // CLOSEST matching ancestor (not the largest), which is what we want.
    const known = node.closest && node.closest(
      '[data-urn*="urn:li:activity"], [data-urn*="urn:li:ugcPost"], [data-urn*="urn:li:share"], '
      + '.feed-shared-update-v2, [class*="feed-shared-update"], [class*="feed-shared-post"], '
      + 'article'
    );
    if (known) return known;

    // Pass 2 — bounded size heuristic. Walk up until an ancestor is plausibly
    // a single post (160–1200px tall). Stop hard at 1200px so we never grab
    // the whole feed column.
    const editorHeight = (node.offsetHeight || 40);
    const minPostHeight = Math.max(160, editorHeight * 3);
    let p = node.parentElement;
    let depth = 0;
    while (p && p !== document.body && depth < 15) {
      const h = p.offsetHeight || 0;
      if (h >= minPostHeight && h <= 1500 && (p.innerText || '').trim().length > 30) {
        return p;
      }
      if (h > 1500) return null; // overshooting — better to fail than use the whole feed
      p = p.parentElement;
      depth++;
    }
    return null;
  }

  const POST_TEXT_SELECTORS = [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.update-components-update-v2__commentary',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '[class*="update-components-text"]',
    '[class*="feed-shared-text"]',
    '[class*="update-components-update-v2__commentary"]',
    '[class*="feed-shared-inline-show-more-text"]',
    '[class*="break-words"]',
  ].join(', ');

  function readTextFrom(node) {
    if (!node) return '';
    const t = (node.innerText || '').trim();
    if (t.length < 5) return '';
    return t.replace(/\s+\n/g, '\n').slice(0, 3000);
  }

  function extractPostText(container) {
    if (!container) return '';
    // Pass 1 — known selectors inside the container
    const node = container.querySelector(POST_TEXT_SELECTORS);
    const fromContainer = readTextFrom(node);
    if (fromContainer) return fromContainer;
    // Pass 2 — search the whole document. In LinkedIn's comment-overlay/modal
    // view, the post text element may live outside our local container.
    // Pick the LARGEST visible match — usually the main post body.
    let best = '';
    document.querySelectorAll(POST_TEXT_SELECTORS).forEach((n) => {
      const t = readTextFrom(n);
      if (t.length > best.length) best = t;
    });
    return best;
  }

  function extractImageDescription(container) {
    if (!container) return '';
    const imgs = container.querySelectorAll('img');
    const alts = [];
    imgs.forEach((img) => {
      const a = (img.getAttribute('alt') || '').trim();
      if (a && a.length > 3 && !/^(profile|photo)$/i.test(a) && !alts.includes(a)) alts.push(a);
    });
    return alts.slice(0, 2).join('; ').slice(0, 500);
  }

  function extractAuthor(container) {
    if (!container) return '';
    const a = container.querySelector(
      '.update-components-actor__name, .update-components-actor__title span[dir="ltr"], .feed-shared-actor__name'
    );
    if (!a) return '';
    const visible = a.querySelector('span[aria-hidden="true"]') || a;
    return (visible.innerText || '').trim().split('\n')[0];
  }

  function extractPostUrl(container) {
    if (!container) return location.href;
    const urn = container.getAttribute('data-urn') || '';
    if (urn) {
      const match = urn.match(/urn:li:activity:(\d+)/);
      if (match) return 'https://www.linkedin.com/feed/update/urn:li:activity:' + match[1] + '/';
    }
    return location.href;
  }

  function isOwnPost(container) {
    if (!container) return false;
    return !!container.querySelector('[data-control-name="actor.see_your_post"]')
      || /\byou\b/i.test((container.querySelector('.update-components-actor__description') || {}).innerText || '');
  }

  // ── Find the LinkedIn editor element to insert text into ─────────────────────
  function findEditorWithin(box) {
    if (!box) return null;
    return box.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], .editor-content [contenteditable="true"]');
  }

  function insertText(editor, text) {
    if (!editor) return false;
    editor.focus();
    // Replace any "placeholder" empty state
    editor.innerHTML = '';
    const lines = text.split(/\n/);
    lines.forEach((line, i) => {
      const p = document.createElement('p');
      if (line) p.textContent = line; else p.innerHTML = '<br/>';
      editor.appendChild(p);
    });
    // Trigger LinkedIn's input handler so the Post button enables
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    return true;
  }

  // ── Popover ──────────────────────────────────────────────────────────────────
  let activePopover = null;
  let outsideClickHandler = null;
  function closePopover() {
    if (activeDialog) {
      try { if (activeDialog.open) activeDialog.close(); } catch (_) {}
      activeDialog.remove();
      activeDialog = null;
    }
    activePopover = null;
    if (outsideClickHandler) {
      document.removeEventListener('keydown', outsideClickHandler);
      outsideClickHandler = null;
    }
  }

  // Active <dialog> element. Using a native <dialog> via showModal() puts
  // our popover into the browser's top layer, which always renders above
  // every regular element — and competes correctly with LinkedIn's own
  // <dialog>-based fullscreen image viewer (last opened wins by DOM order).
  let activeDialog = null;

  function openPopover(anchor, opts) {
    console.log('[Bibix LinkedIn AI] openPopover called', opts && opts.title);
    closePopover();
    const pop = document.createElement('dialog');
    pop.className = 'bibix-popover';
    Object.assign(pop.style, {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      margin: '0',
      padding: '18px',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '14px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      width: '440px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      color: '#1f2937',
      zIndex: '2147483647',
    });
    // Style the ::backdrop (dialog's built-in dimmer) via a stylesheet hook.
    // The class .bibix-popover already styles the dialog backdrop via CSS.
    pop.addEventListener('click', (e) => {
      // Native <dialog> sends a click event on the dialog itself when the
      // user clicks the ::backdrop. Detect that and close.
      if (e.target === pop) closePopover();
    });
    pop.addEventListener('close', () => closePopover());
    const header = el('div', { className: 'bibix-popover-header' }, [
      el('div', { className: 'bibix-popover-title' }, '✨ Bibix AI · ' + opts.title),
      el('button', { className: 'bibix-popover-close', onClick: closePopover }, '×'),
    ]);
    const errBox = el('div', { className: 'bibix-error' });
    errBox.hidden = true;
    const body = el('div', { className: 'bibix-popover-text' }, [
      el('div', { className: 'bibix-popover-loading' }, [
        el('span', { className: 'bibix-dot' }), el('span', { className: 'bibix-dot' }), el('span', { className: 'bibix-dot' }),
        ' generating…',
      ]),
    ]);
    const actions = el('div', { className: 'bibix-popover-actions' }, [
      el('button', { onClick: closePopover }, 'Cancel'),
      el('button', { className: 'primary', onClick: () => {
        if (opts.onInsert) opts.onInsert(body.textContent.trim());
        closePopover();
      } }, 'Insert into comment'),
    ]);
    const regen = el('button', { onClick: () => generate() }, '↻ Regenerate');
    actions.insertBefore(regen, actions.firstChild);

    pop.appendChild(header);
    pop.appendChild(errBox);
    pop.appendChild(body);
    pop.appendChild(actions);

    document.documentElement.appendChild(pop);
    try { pop.showModal(); } catch (_) { /* fallback: just attach */ }
    activeDialog = pop;
    activePopover = pop;

    async function generate() {
      errBox.hidden = true;
      body.innerHTML = '';
      const loading = el('div', { className: 'bibix-popover-loading' }, [
        el('span', { className: 'bibix-dot' }), el('span', { className: 'bibix-dot' }), el('span', { className: 'bibix-dot' }),
        ' generating…',
      ]);
      body.appendChild(loading);
      const res = await opts.runGenerate();
      if (res.ok) {
        body.textContent = res.data.text || '';
      } else {
        body.textContent = '';
        errBox.hidden = false;
        errBox.textContent = res.error || 'Generation failed';
        if (res.status === 401) errBox.textContent += ' — open the extension and sign in.';
      }
    }
    generate();

    // Esc key also dismisses
    outsideClickHandler = (e) => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('keydown', outsideClickHandler);
  }

  function alreadyHasBibixButton(node) {
    if (!node) return false;
    if (node.querySelector && node.querySelector('.' + BTN_CLASS)) return true;
    // Also check nearby siblings — LinkedIn occasionally re-mounts wrappers
    let p = node.parentElement;
    for (let i = 0; i < 3 && p; i++) {
      if (p.querySelector && p.querySelector('.' + BTN_CLASS)) return true;
      p = p.parentElement;
    }
    return false;
  }

  // ── Inject buttons next to comment boxes ─────────────────────────────────────
  function injectIntoCommentBox(box) {
    if (!box || box.getAttribute(PROCESSED_ATTR)) return;
    if (alreadyHasBibixButton(box)) { box.setAttribute(PROCESSED_ATTR, '1'); return; }
    box.setAttribute(PROCESSED_ATTR, '1');

    const postContainer = findPostContainer(box);
    const actions = box.querySelector('.comments-comment-box__detour-container, .comments-comment-texteditor__footer, .comments-comment-box__form-container');
    // Best fallback: append directly inside the box
    const host = actions || box;

    // Always inject a Bulk Actions button alongside AI Comment. Use the post
    // container if we found one, otherwise fall back to the comment box —
    // the dialog itself does a document-wide search for comments either way.
    const bulkPost = postContainer || box;
    if (bulkPost && bulkPost.getAttribute(BULK_PROCESSED) !== '1' && !host.querySelector('.' + BULK_BTN_CLASS)) {
      bulkPost.setAttribute(BULK_PROCESSED, '1');
      const bulkBtn = el('button', {
        className: BULK_BTN_CLASS,
        type: 'button',
        title: 'Bibix Bulk Actions — auto-reply / auto-like multiple comments',
        onClick: (e) => {
          e.preventDefault(); e.stopPropagation();
          openBulkDialog(bulkPost);
        },
      }, [el('span', { className: 'bibix-spark' }, '✨'), 'Bulk']);
      host.insertBefore(bulkBtn, host.firstChild);
    }

    const btn = el('button', {
      className: BTN_CLASS,
      type: 'button',
      onClick: (e) => {
        console.log('[Bibix LinkedIn AI] AI Comment button clicked');
        e.preventDefault();
        e.stopPropagation();
        const editor = findEditorWithin(box);
        // Re-resolve post container at click time — by now LinkedIn may have
        // rendered the post DOM that was lazy at injection time.
        const container = findPostContainer(box) || postContainer;
        const postText = extractPostText(container);
        const imageDescription = extractImageDescription(container);
        const author = extractAuthor(container);
        const url = extractPostUrl(container);
        console.log('[Bibix LinkedIn AI] generating with:', {
          author,
          postTextPreview: (postText || '').slice(0, 160),
          imageDescriptionPreview: (imageDescription || '').slice(0, 160),
          url,
          containerTag: container && container.tagName,
          containerCls: container && (container.className || '').toString().slice(0, 120),
        });
        if (!postText && !imageDescription && !author) {
          openPopover(btn, {
            title: 'Comment',
            runGenerate: () => Promise.resolve({ ok: false, error: 'Could not read this post. Try opening it in a dedicated page (click the timestamp) and try again.' }),
          });
          return;
        }
        openPopover(btn, {
          title: 'Comment',
          runGenerate: () => send('generateComment', { postText, imageDescription, authorName: author, postUrl: url }),
          onInsert: (text) => insertText(editor, text),
        });
      },
    }, [el('span', { className: 'bibix-spark' }, '✨'), 'AI Comment']);

    host.insertBefore(btn, host.firstChild);
  }

  function injectIntoReplyBox(box) {
    if (!box || box.getAttribute(PROCESSED_ATTR)) return;
    if (alreadyHasBibixButton(box)) { box.setAttribute(PROCESSED_ATTR, '1'); return; }
    box.setAttribute(PROCESSED_ATTR, '1');

    // Find the comment we're replying to
    const commentRoot = box.closest('.comments-comment-item, .comments-comment-entity');
    const commentTextEl = commentRoot && commentRoot.querySelector('.comments-comment-item__main-content, .update-components-text, .comments-comment-item-content-body');
    const commentText = commentTextEl ? commentTextEl.innerText.trim() : '';
    const commentAuthorEl = commentRoot && commentRoot.querySelector('.comments-post-meta__name-text, .comments-post-meta__actor-link');
    const commentAuthor = commentAuthorEl ? commentAuthorEl.innerText.trim().split('\n')[0] : '';

    const postContainer = findPostContainer(box);
    const postText = extractPostText(postContainer);
    const url = extractPostUrl(postContainer);
    const ownPost = isOwnPost(postContainer);

    const btn = el('button', {
      className: BTN_CLASS,
      type: 'button',
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const editor = findEditorWithin(box);
        openPopover(btn, {
          title: 'Reply',
          runGenerate: () => send('generateReply', {
            commentText, commentAuthor, postText, isOwnPost: ownPost, postUrl: url,
          }),
          onInsert: (text) => insertText(editor, text),
        });
      },
    }, [el('span', { className: 'bibix-spark' }, '✨'), 'AI Reply']);

    const host = box.querySelector('.comments-comment-box__detour-container, .comments-comment-texteditor__footer') || box;
    host.insertBefore(btn, host.firstChild);
  }

  // ── Inject button for "Add your perspective" (Top Voice contributions) ───────
  function injectIntoContributionBox(box) {
    if (!box || box.getAttribute(PROCESSED_ATTR)) return;
    if (alreadyHasBibixButton(box)) { box.setAttribute(PROCESSED_ATTR, '1'); return; }
    box.setAttribute(PROCESSED_ATTR, '1');

    const titleEl = document.querySelector('h1, .article-header__title, .contribution-prompt__title');
    const perspectiveEl = box.closest('[data-test-id*="perspective"], section') || document.body;
    const promptEl = perspectiveEl.querySelector('h2, h3, .contribution-prompt__title');
    const perspectiveTitle = promptEl ? promptEl.innerText.trim() : '';
    const topic = titleEl ? titleEl.innerText.trim() : document.title;

    const btn = el('button', {
      className: BTN_CLASS,
      type: 'button',
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const editor = findEditorWithin(box);
        openPopover(btn, {
          title: 'Contribution',
          runGenerate: () => send('generateContribution', { topic, perspectiveTitle, postUrl: location.href }),
          onInsert: (text) => insertText(editor, text),
        });
      },
    }, [el('span', { className: 'bibix-spark' }, '✨'), 'AI Perspective']);

    const host = box.querySelector('.comments-comment-texteditor__footer, .ql-toolbar') || box;
    host.insertBefore(btn, host.firstChild);
  }

  // ── Discovery: walk up from every contenteditable to find a "comment box"
  // host element. This is resilient to LinkedIn renaming classes — it works
  // off the universal contenteditable role rather than specific class names.

  function ancestorMatching(node, predicate, maxDepth = 12) {
    let cur = node;
    for (let i = 0; i < maxDepth && cur && cur !== document.body; i++) {
      if (predicate(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function looksLikeCommentBox(node) {
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    // Match comment-related wrappers but NOT the "Start a post" composer or contribution boxes
    return /comments?-comment-box|comments?-comment-texteditor|comments?-comments?-box/i.test(cls);
  }

  function looksLikePostShareComposer(node) {
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    return /share-creation-state|share-box-modal|share-box|sharing-box/i.test(cls);
  }

  function looksLikeReplyBox(node) {
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    return /comment-box--reply|reply-editor|comments-reply/i.test(cls);
  }

  function looksLikeContributionBox(node) {
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    return /contribution-prompt|perspective|article-contrib/i.test(cls);
  }

  function findEditorHost(editor) {
    return ancestorMatching(editor, looksLikeCommentBox);
  }

  // Universal injection: for every contenteditable that looks like a LinkedIn
  // comment/reply/contribution editor, find a sensible mount target and place
  // a single button there. Deduplication: skip if any .bibix-ai-btn already
  // exists in the mount target or its ancestors.
  function injectButtonNearEditor(editor) {
    if (editor.getAttribute(PROCESSED_ATTR) === '1') return;
    if (ancestorMatching(editor, looksLikePostShareComposer)) return;
    if (alreadyHasBibixButton(editor)) { editor.setAttribute(PROCESSED_ATTR, '1'); return; }

    // Prefer a known comment-box wrapper.
    let mountTarget = ancestorMatching(editor, looksLikeCommentBox);
    if (!mountTarget) {
      // No known wrapper class — walk up to a slightly larger container.
      let p = editor.parentElement;
      for (let i = 0; i < 5 && p && p !== document.body; i++) {
        if (p.offsetHeight > editor.offsetHeight + 4) { mountTarget = p; break; }
        p = p.parentElement;
      }
      if (!mountTarget) mountTarget = editor.parentElement;
    }
    if (!mountTarget) return;
    editor.setAttribute(PROCESSED_ATTR, '1');

    if (ancestorMatching(editor, looksLikeContributionBox)) {
      injectIntoContributionBox(mountTarget);
      return;
    }
    if (looksLikeReplyBox(mountTarget) || ancestorMatching(editor, looksLikeReplyBox)) {
      injectIntoReplyBox(mountTarget);
      return;
    }
    injectIntoCommentBox(mountTarget);
  }

  function scan() {
    // 1. Find every plausible comment editor on the page.
    const editors = document.querySelectorAll(
      '.ql-editor[contenteditable="true"], '
      + 'div[contenteditable="true"][role="textbox"], '
      + 'div[contenteditable="true"][aria-label*="comment" i], '
      + 'div[contenteditable="true"][aria-label*="reply" i], '
      + 'div[contenteditable="true"][aria-placeholder*="comment" i], '
      + 'div[contenteditable="true"][data-placeholder*="comment" i]'
    );
    editors.forEach(injectButtonNearEditor);

    // 2. Also: handle collapsed comment-box placeholders (visible BEFORE user
    // clicks them). Tight selector to avoid matching individual comment items.
    document.querySelectorAll(
      '.comments-comment-box:not(.comments-comment-box--reply), '
      + '[class*="comments-comment-box"]:not([class*="reply"])'
    ).forEach((box) => {
      if (box.getAttribute(PROCESSED_ATTR) === '1') return;
      if (box.querySelector('[contenteditable="true"]')) return;
      if (box.querySelector('.' + BTN_CLASS)) return;
      if (ancestorMatching(box, looksLikePostShareComposer)) return;
      injectIntoCommentBox(box);
    });

    // 3. Inject Bulk Actions button into each post's social-action bar.
    injectBulkButtons();
    // 4. If on a profile page, inject the "Find Contact" button.
    injectFindContactButton();
  }

  // ── Bulk Actions: auto-reply / random-like across many comments ────────────
  const BULK_BTN_CLASS = 'bibix-bulk-btn';
  const BULK_PROCESSED = 'data-bibix-bulk-processed';
  let bulkAborted = false;

  function rand(min, max) { return Math.floor(min + Math.random() * (max - min)); }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function injectBulkButtons() {
    // Find each post wrapper that has a social-actions bar (Like/Comment/Repost row)
    document.querySelectorAll(
      '[data-urn*="urn:li:activity"], [data-urn*="urn:li:ugcPost"], [data-urn*="urn:li:share"], '
      + '.feed-shared-update-v2, [class*="feed-shared-update"], article'
    ).forEach((post) => {
      if (post.getAttribute(BULK_PROCESSED) === '1') return;
      const bar = post.querySelector(
        '.feed-shared-social-action-bar, .social-actions-bar, [class*="social-action"], '
        + '[class*="social-actions"], .update-v2-social-activity'
      );
      if (!bar) return;
      // Skip if already injected
      if (bar.querySelector('.' + BULK_BTN_CLASS)) { post.setAttribute(BULK_PROCESSED, '1'); return; }
      post.setAttribute(BULK_PROCESSED, '1');

      const btn = el('button', {
        className: BULK_BTN_CLASS,
        type: 'button',
        title: 'Bibix Bulk Actions — auto-reply / auto-like multiple comments',
        onClick: (e) => {
          e.preventDefault(); e.stopPropagation();
          openBulkDialog(post);
        },
      }, [el('span', { className: 'bibix-spark' }, '✨'), 'Bulk']);
      bar.appendChild(btn);
    });
  }

  // -- Comment discovery on a post --
  const COMMENT_ITEM_SELECTORS = [
    '.comments-comment-item',
    '.comments-comment-entity',
    '[class*="comments-comment-item"]',
    '[class*="comments-comment-entity"]',
    '[class*="comments-comments-entity"]',
    '[class*="comment-entity-v"]',
    '[data-id*="urn:li:comment"]',
    'article[class*="comment"]',
  ];
  const COMMENT_ITEM_SELECTOR = COMMENT_ITEM_SELECTORS.join(', ');

  function findCommentItems(post) {
    // Search post-local first
    let items = Array.from(post.querySelectorAll(COMMENT_ITEM_SELECTOR))
      .filter((c) => c.offsetHeight > 0);
    if (items.length > 0) return items;
    // Fallback: scan the whole document by class.
    items = Array.from(document.querySelectorAll(COMMENT_ITEM_SELECTOR))
      .filter((c) => c.offsetHeight > 0);
    if (items.length > 0) return items;
    // Last-resort heuristic: data-id urn pattern.
    items = Array.from(document.querySelectorAll('[data-id]'))
      .filter((n) => /urn:li:(comment|reply)/i.test(n.getAttribute('data-id') || '') && n.offsetHeight > 0);
    if (items.length > 0) return items;
    // Final fallback: LinkedIn class names are obfuscated. Find comment items
    // structurally — every comment has a Like-type button (aria-label or
    // class-based) AND a Reply-type button nearby. Walk up from each Like
    // button to find the smallest ancestor that also contains a Reply
    // button — that's the comment wrapper.
    return findCommentItemsStructurally();
  }

  function findLikeButtonsGlobal() {
    const P = '[Bibix Bulk]';
    // Strategy 1 — aria-label patterns (multilingual)
    let likeBtns = Array.from(document.querySelectorAll(
      'button[aria-label*="Like" i], button[aria-label*="React" i], '
      + 'button[aria-label*="לייק" i], button[aria-label*="אהבתי" i], button[aria-label*="הגב" i], '
      + 'button[aria-label*="Me gusta" i], button[aria-label*="J\'aime" i], '
      + 'button[aria-label*="Gefällt" i], button[aria-label*="Mi piace" i]'
    ));
    console.log(P, 'like via aria-label:', likeBtns.length);
    // Strategy 2 — data-control-name
    if (likeBtns.length === 0) {
      likeBtns = Array.from(document.querySelectorAll(
        'button[data-control-name*="react" i], button[data-control-name*="like" i]'
      ));
      console.log(P, 'like via data-control-name:', likeBtns.length);
    }
    // Strategy 3 — class name patterns
    if (likeBtns.length === 0) {
      likeBtns = Array.from(document.querySelectorAll(
        'button[class*="react-button"], button[class*="reactions"], button[class*="like-button"]'
      ));
      console.log(P, 'like via class hints:', likeBtns.length);
    }
    // Strategy 4 — last resort: any button with aria-pressed (toggleable) +
    // an SVG icon inside. Captures icon-only like/react buttons.
    if (likeBtns.length === 0) {
      likeBtns = Array.from(document.querySelectorAll('button[aria-pressed]'))
        .filter((b) => b.querySelector('svg, [data-test-icon]'));
      console.log(P, 'like via aria-pressed+svg:', likeBtns.length);
    }
    return likeBtns.filter((b) => b.offsetHeight > 0 && b.offsetWidth > 0);
  }

  function findCommentItemsStructurally() {
    const P = '[Bibix Bulk]';
    const likeBtns = findLikeButtonsGlobal();
    console.log(P, 'likeBtns visible:', likeBtns.length);
    const seen = new Set();
    const items = [];
    likeBtns.forEach((btn) => {
      // Walk up looking for an ancestor that also contains a Reply trigger
      let p = btn.parentElement;
      for (let i = 0; i < 12 && p && p !== document.body; i++) {
        const candidates = Array.from(p.querySelectorAll('button, a[role="button"]'));
        const hasReply = candidates.some((c) => {
          if (c === btn) return false;
          const cls = (c.className || '').toString().toLowerCase();
          const dcn = (c.getAttribute('data-control-name') || '').toLowerCase();
          const txt = (c.innerText || '').trim();
          const lbl = (c.getAttribute('aria-label') || '').trim();
          return /reply/.test(cls) || /reply/.test(dcn)
            || /^(reply|respond|responder|antworten|תגובה|השב|להגיב|rispondi|svar)\b/i.test(txt + ' ' + lbl);
        });
        if (hasReply && p.offsetHeight > 30 && p.offsetHeight < 800) {
          if (!seen.has(p)) { seen.add(p); items.push(p); }
          break;
        }
        p = p.parentElement;
      }
    });
    console.log(P, 'structural items found:', items.length);
    return items;
  }

  function dumpCommentDiagnostic(label) {
    const P = '[Bibix Bulk]';
    console.log(P, label, '— diagnostic dump:');
    COMMENT_ITEM_SELECTORS.forEach((sel) => {
      console.log(P, '  selector:', sel, '→', document.querySelectorAll(sel).length, 'matches');
    });
    const dataIds = Array.from(document.querySelectorAll('[data-id]'));
    console.log(P, '  total [data-id] elements:', dataIds.length);
    dataIds.slice(0, 6).forEach((n, i) => console.log(P, '   data-id #' + i + ':', n.getAttribute('data-id'), '|', (n.className || '').toString().slice(0, 60)));
    const dataUrns = Array.from(document.querySelectorAll('[data-urn]'));
    console.log(P, '  total [data-urn] elements:', dataUrns.length);
    dataUrns.slice(0, 6).forEach((n, i) => console.log(P, '   data-urn #' + i + ':', n.getAttribute('data-urn'), '|', (n.className || '').toString().slice(0, 60)));
    const classComment = Array.from(document.querySelectorAll('[class*="comment"]'));
    console.log(P, '  total elements with "comment" in class:', classComment.length);
    const classes = new Set();
    classComment.forEach((n) => {
      ((n.className || '').toString().split(/\s+/)).forEach((c) => {
        if (c.toLowerCase().includes('comment')) classes.add(c);
      });
    });
    console.log(P, '  distinct class tokens with "comment":', Array.from(classes).slice(0, 30));
  }

  function commentText(item) {
    const t = item.querySelector(
      '.comments-comment-item__main-content, .update-components-text, '
      + '.comments-comment-item-content-body, [class*="comments-comment-item__main-content"]'
    );
    return t ? (t.innerText || '').trim() : '';
  }

  function commentAuthor(item) {
    const a = item.querySelector(
      '.comments-post-meta__name-text, .comments-post-meta__actor-link, '
      + '[class*="comments-post-meta__name"]'
    );
    return a ? (a.innerText || '').trim().split('\n')[0] : '';
  }

  // Restrict to buttons that belong to *this* comment, not to its nested
  // replies (which live inside a child comment-list container).
  function buttonsBelongingTo(item) {
    const all = Array.from(item.querySelectorAll('button, a[role="button"]'));
    // Identify any nested reply containers within this item
    const nestedContainers = Array.from(item.querySelectorAll(
      '[class*="comments-comment-list__container"], [class*="comments-replies"], [class*="comment-replies"]'
    ));
    return all.filter((b) => !nestedContainers.some((c) => c.contains(b)));
  }

  function findLikeButton(item) {
    const candidates = buttonsBelongingTo(item).filter((b) => {
      const cls = (b.className || '').toString().toLowerCase();
      const dcn = (b.getAttribute('data-control-name') || '').toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      // Class / data hints (language-agnostic)
      if (/react-button|reactions-react-button/.test(cls)) return true;
      if (/react|like/.test(dcn)) return true;
      // aria-label patterns across common LinkedIn locales
      if (/\blike\b|\bלייק\b|\bאהבתי\b|me gusta|j['']aime|gefällt mir|mi piace/i.test(aria)) return true;
      // SVG button with aria-pressed (toggleable react button)
      if (b.getAttribute('aria-pressed') !== null && b.querySelector('svg, [data-test-icon]')) return true;
      return false;
    });
    for (const b of candidates) {
      if (b.getAttribute('aria-pressed') === 'true') continue;
      const cls = (b.className || '').toString().toLowerCase();
      if (/active|selected|liked/.test(cls)) continue;
      return b;
    }
    return null;
  }

  function findReplyTrigger(item) {
    // Language-agnostic: prefer class/data hints; fall back to text only for
    // English UIs.
    const candidates = buttonsBelongingTo(item);
    // Pass 1 — class/data hints
    for (const b of candidates) {
      const cls = (b.className || '').toString().toLowerCase();
      const dcn = (b.getAttribute('data-control-name') || '').toLowerCase();
      if (/reply-action|reply-button|comments-comment-social-bar__reply/.test(cls)) return b;
      if (/reply/.test(dcn)) return b;
    }
    // Pass 2 — multilingual text/aria-label patterns (English/Hebrew/Spanish/etc.)
    const REPLY_WORDS = /^(reply|respond|respondre|responder|antworten|תגובה|השב|להגיב|rispondi|svar)\b/i;
    for (const b of candidates) {
      const txt = (b.innerText || '').trim();
      const label = (b.getAttribute('aria-label') || '').trim();
      if (REPLY_WORDS.test(txt) || REPLY_WORDS.test(label)) return b;
    }
    return null;
  }

  function findSubmitInside(box) {
    if (!box) return null;
    const buttons = box.querySelectorAll('button');
    // Pass 1 — class hints (language-agnostic)
    for (const b of buttons) {
      const cls = (b.className || '').toString().toLowerCase();
      if (/comments-comment-box__submit|submit-button|post-button/.test(cls) && !b.disabled) return b;
    }
    // Pass 2 — multilingual text/aria-label patterns
    const SUBMIT_WORDS = /^(post|reply|comment|publicar|enviar|publish|publicar|publier|פרסם|פרסום|תגובה)\b/i;
    for (const b of buttons) {
      const txt = (b.innerText || '').trim();
      const label = (b.getAttribute('aria-label') || '').trim();
      if ((SUBMIT_WORDS.test(txt) || SUBMIT_WORDS.test(label)) && !b.disabled) return b;
    }
    return null;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function scrollAndLoadComments(post, targetCount) {
    // LinkedIn lazy-loads comments; click "See more comments" buttons until we
    // have enough or run out.
    for (let i = 0; i < 6; i++) {
      const items = findCommentItems(post);
      if (items.length >= targetCount) return items;
      const more = document.querySelector(
        'button.comments-comments-list__load-more-comments-button, '
        + 'button[aria-label*="more comment" i], '
        + 'button[aria-label*="previous reply" i], '
        + 'button[aria-label*="load more" i]'
      );
      if (!more) break;
      more.scrollIntoView({ block: 'center' });
      more.click();
      await wait(rand(1200, 2200));
    }
    return findCommentItems(post);
  }

  function openBulkDialog(post) {
    closePopover();
    const pop = document.createElement('dialog');
    pop.className = 'bibix-popover';
    Object.assign(pop.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      margin: '0', padding: '20px', background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      width: '420px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', color: '#1f2937', zIndex: '2147483647',
    });
    pop.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;background:linear-gradient(135deg,#4338ca,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent">
        ✨ Bibix Bulk Actions
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">
        Acts on the comments under this post. Random 5–15s delays. Click Cancel anytime to stop.
      </div>
      <div style="margin-bottom:14px;padding:12px;border:1px solid #e2e8f0;border-radius:10px">
        <div style="font-weight:600;margin-bottom:6px">🤖 Auto-Reply</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px">Generate AI replies to the first N comments and post them.</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="bibix-reply-count" type="number" min="1" max="25" value="3" style="width:60px;padding:6px;border:1px solid #e2e8f0;border-radius:6px">
          <span style="font-size:12px;color:#64748b">comments</span>
          <button id="bibix-go-reply" style="margin-left:auto;background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Start replying</button>
        </div>
      </div>
      <div style="margin-bottom:14px;padding:12px;border:1px solid #e2e8f0;border-radius:10px">
        <div style="font-weight:600;margin-bottom:6px">👍 Random Likes</div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px">Like N randomly-chosen comments.</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="bibix-like-count" type="number" min="1" max="25" value="5" style="width:60px;padding:6px;border:1px solid #e2e8f0;border-radius:6px">
          <span style="font-size:12px;color:#64748b">comments</span>
          <button id="bibix-go-like" style="margin-left:auto;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Start liking</button>
        </div>
      </div>
      <div id="bibix-bulk-status" style="font-size:12px;color:#475569;min-height:18px;margin-bottom:10px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="bibix-bulk-close" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Close</button>
      </div>
    `;
    document.documentElement.appendChild(pop);
    try { pop.showModal(); } catch (_) {}
    activeDialog = pop;
    activePopover = pop;

    const status = pop.querySelector('#bibix-bulk-status');
    const setStatus = (s) => { if (status) status.textContent = s; };
    pop.querySelector('#bibix-bulk-close').addEventListener('click', () => { bulkAborted = true; closePopover(); });
    pop.addEventListener('click', (e) => { if (e.target === pop) { bulkAborted = true; closePopover(); } });
    pop.querySelector('#bibix-go-reply').addEventListener('click', async () => {
      bulkAborted = false;
      const n = Math.max(1, Math.min(25, Number(pop.querySelector('#bibix-reply-count').value) || 3));
      await runBulkReply(post, n, setStatus);
    });
    pop.querySelector('#bibix-go-like').addEventListener('click', async () => {
      bulkAborted = false;
      const n = Math.max(1, Math.min(25, Number(pop.querySelector('#bibix-like-count').value) || 5));
      await runBulkLike(post, n, setStatus);
    });
  }

  async function runBulkReply(post, count, setStatus) {
    setStatus(`Loading comments…`);
    const items = await scrollAndLoadComments(post, count);
    const targets = items.slice(0, count);
    if (targets.length === 0) {
      dumpCommentDiagnostic('No comments found for reply');
      setStatus('No comments found. See console for details.');
      return;
    }
    setStatus(`Found ${targets.length} comments. Starting…`);
    const postText = extractPostText(findPostContainer(post) || post);
    const postUrl = extractPostUrl(post);

    let done = 0, errors = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkAborted) { setStatus(`Stopped after ${done}/${targets.length}.`); return; }
      const item = targets[i];
      const author = commentAuthor(item);
      const text = commentText(item);
      setStatus(`Replying to ${i + 1}/${targets.length}${author ? ' — ' + author : ''}…`);
      try {
        // 1. Generate reply via background worker
        const gen = await send('generateReply', {
          commentText: text, commentAuthor: author, postText, isOwnPost: false, postUrl,
        });
        if (!gen.ok) throw new Error(gen.error || 'AI error');
        const replyText = gen.data.text;

        // 2. Click the comment's Reply trigger to open its inline editor
        const trigger = findReplyTrigger(item);
        if (!trigger) throw new Error('Could not find Reply button');
        trigger.click();
        // 3. Wait for the editor to appear
        let editor = null;
        for (let t = 0; t < 30; t++) {
          editor = item.querySelector('[contenteditable="true"][role="textbox"], .ql-editor[contenteditable="true"]');
          if (editor) break;
          await wait(150);
        }
        if (!editor) throw new Error('Reply editor never appeared');
        // 4. Insert generated text
        insertText(editor, replyText);
        await wait(rand(600, 1100));
        // 5. Find and click the Post/Reply submit button
        const box = ancestorMatching(editor, looksLikeCommentBox) || editor.parentElement;
        const submit = findSubmitInside(box);
        if (!submit) throw new Error('Could not find Post/Reply submit button');
        submit.click();
        done++;
        setStatus(`Posted ${done}/${targets.length}. Waiting…`);
      } catch (e) {
        errors++;
        console.warn('[Bibix Bulk] reply error:', e.message);
        setStatus(`Skipped ${i + 1} (${e.message}). Continuing…`);
      }
      // Random delay between actions (5–15s) to look human
      if (i < targets.length - 1) await wait(rand(5000, 15000));
    }
    setStatus(`Done. ${done} posted, ${errors} skipped.`);
  }

  async function runBulkLike(post, count, setStatus) {
    setStatus(`Loading comments…`);
    const items = await scrollAndLoadComments(post, count * 2);
    // Filter to ones we haven't liked yet
    const candidates = items.filter((it) => findLikeButton(it));
    if (candidates.length === 0) {
      if (items.length === 0) {
        dumpCommentDiagnostic('No comments found for like');
      } else {
        const sample = items[0];
        const btns = buttonsBelongingTo(sample);
        console.log('[Bibix Bulk] Found', items.length, 'comments but no like button. Sample buttons:');
        btns.forEach((b, i) => console.log(' ', i, {
          cls: (b.className || '').toString().slice(0, 80),
          dcn: b.getAttribute('data-control-name'),
          aria: b.getAttribute('aria-label'),
          pressed: b.getAttribute('aria-pressed'),
          text: (b.innerText || '').slice(0, 40),
        }));
      }
      setStatus('No likeable comments found. See console for details.');
      return;
    }
    const targets = shuffle(candidates).slice(0, count);
    setStatus(`Found ${candidates.length} candidates. Liking ${targets.length}…`);

    let done = 0, errors = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkAborted) { setStatus(`Stopped after ${done}/${targets.length}.`); return; }
      const item = targets[i];
      const author = commentAuthor(item);
      setStatus(`Liking ${i + 1}/${targets.length}${author ? ' — ' + author : ''}…`);
      try {
        const btn = findLikeButton(item);
        if (!btn) throw new Error('No like button');
        btn.click();
        done++;
      } catch (e) {
        errors++;
        console.warn('[Bibix Bulk] like error:', e.message);
      }
      // Likes can be a bit faster than replies — still humanlike (1.5–4s)
      if (i < targets.length - 1) await wait(rand(1500, 4000));
    }
    setStatus(`Done. ${done} liked, ${errors} skipped.`);
  }

  // ── Find Contact Info on LinkedIn profile pages (Hunter.io) ────────────────
  const FIND_BTN_CLASS = 'bibix-find-btn';
  const FIND_PROCESSED = 'data-bibix-find-processed';

  function isProfilePage() { return /^\/in\//.test(location.pathname); }

  function extractProfileInfo() {
    // --- JSON-LD first (most reliable, untouched by class renames) ---------
    let ldName = '', ldHeadline = '', ldCompany = '', ldPosition = '';
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const data = JSON.parse(s.textContent || s.innerText || 'null');
        const flat = [];
        const collect = (n) => {
          if (!n) return;
          if (Array.isArray(n)) { n.forEach(collect); return; }
          if (typeof n !== 'object') return;
          flat.push(n);
          if (n['@graph']) collect(n['@graph']);
        };
        collect(data);
        for (const node of flat) {
          if (node['@type'] === 'Person' || node['@type'] === 'ProfilePage') {
            const p = node['@type'] === 'ProfilePage' ? (node.mainEntity || node) : node;
            if (p.name && !ldName) ldName = String(p.name).trim();
            if (p.jobTitle && !ldPosition) ldPosition = String(p.jobTitle).trim();
            if (p.description && !ldHeadline) ldHeadline = String(p.description).trim();
            const wf = p.worksFor;
            if (wf && !ldCompany) {
              if (Array.isArray(wf) && wf[0]) ldCompany = (wf[0].name || '').trim();
              else if (typeof wf === 'object') ldCompany = (wf.name || '').trim();
              else if (typeof wf === 'string') ldCompany = wf.trim();
            }
          }
        }
      } catch (_) {}
    });

    // --- Full name ----------------------------------------------------------
    let fullName = ldName;
    let titleHeadline = '';
    const title = (document.title || '').trim();
    if (!fullName) {
      let m = title.match(/^(.+?)\s+[-–]\s+(.+?)\s*\|\s*LinkedIn/i);
      if (m) { fullName = m[1].trim(); titleHeadline = m[2].trim(); }
    }
    if (!fullName) {
      const m = title.match(/^(.+?)\s*\|\s*LinkedIn/i);
      if (m) fullName = m[1].trim();
    }
    if (!fullName) {
      const h1 = document.querySelector('main h1') || document.querySelector('h1');
      if (h1) {
        const raw = ((h1.innerText || h1.textContent || '').trim()).split('\n')[0].trim();
        fullName = raw.replace(/\s*[·•]\s*\d+(?:st|nd|rd|th)?\+?\s*$/i, '').trim();
      }
    }
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    // --- Headline -----------------------------------------------------------
    let headline = ldHeadline;
    if (!headline) {
      const metaDesc = document.querySelector('meta[name="description"]')
        || document.querySelector('meta[property="og:description"]');
      if (metaDesc) {
        const c = (metaDesc.getAttribute('content') || '').trim();
        const cleaned = c.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
        if (cleaned && cleaned !== fullName) headline = cleaned;
      }
    }
    if (!headline && titleHeadline) headline = titleHeadline;
    if (!headline) {
      // Strategy A: split <main>'s innerText into lines and find the
      // headline by position relative to the name. Works on any layout
      // because LinkedIn renders all profile text inside <main>.
      const mainEl = document.querySelector('main') || document.body;
      const lines = (mainEl.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
      let nameIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] === fullName) { nameIdx = i; break; }
      }
      // Looser match if exact didn't hit
      if (nameIdx < 0 && fullName) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(fullName) && lines[i].length < fullName.length + 25) { nameIdx = i; break; }
        }
      }
      if (nameIdx >= 0) {
        for (let j = nameIdx + 1; j < Math.min(nameIdx + 8, lines.length); j++) {
          const l = lines[j];
          if (l.length < 6 || l.length > 400) continue;
          if (l === fullName) continue;
          if (/^[·•]/.test(l)) continue;
          if (/^\d/.test(l)) continue;
          if (/^(?:connections?|followers?|mutual|premium|trial|verified|message|connect|follow|contact info|view|see|more options|view\snavigator)\b/i.test(l)) continue;
          if (/\b(connections?|followers?|mutual|degree)\b/i.test(l)) continue;
          headline = l;
          break;
        }
      }
    }

    if (!headline) {
      // Strategy B: geometric — element positioned right below the h1.
      const h1 = document.querySelector('main h1') || document.querySelector('h1');
      if (h1) {
        const h1Rect = h1.getBoundingClientRect();
        const candidates = [];
        document.querySelectorAll('main div, main span, main p').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 50 || r.height < 14 || r.height > 200) return;
          if (r.top < h1Rect.bottom - 4 || r.top > h1Rect.bottom + 100) return;
          if (r.right < h1Rect.left || r.left > h1Rect.right + 100) return;
          const t = (el.innerText || '').trim();
          if (!t || t === fullName) return;
          const firstLine = t.split('\n')[0].trim();
          if (firstLine.length < 6 || firstLine.length > 400) return;
          if (/^[·•]/.test(firstLine)) return;
          if (/^\d/.test(firstLine)) return;
          if (/^(?:connections?|followers?|mutual|premium|trial|verified|message|connect|follow|contact info)\b/i.test(firstLine)) return;
          if (/\b(connections?|followers?|mutual|degree)\b/i.test(firstLine)) return;
          candidates.push({ top: r.top, area: r.width * r.height, firstLine, text: t });
        });
        // Prefer top-most, then most-specific (smallest bounding box) at that level.
        candidates.sort((a, b) => {
          if (Math.abs(a.top - b.top) > 6) return a.top - b.top;
          return a.area - b.area;
        });
        if (candidates[0]) headline = candidates[0].firstLine;
      }
    }

    // --- Parse company + position ------------------------------------------
    let company = ldCompany;
    let position = ldPosition;

    // PRIMARY: read the Experience section. First entry is the current job.
    if (!company || !position) {
      const mainEl = document.querySelector('main') || document.body;
      const mainText = (mainEl.innerText || '');
      // Find "Experience" as a section header on its own line.
      const expMatch = mainText.match(/^Experience\s*$/m);
      if (expMatch) {
        const after = mainText.slice(expMatch.index + expMatch[0].length);
        const expLines = after.split('\n').map((l) => l.trim()).filter(Boolean);
        // Pattern A — multi-role-at-one-company:
        //   Company | "2 yrs 5 mos" | Role1 | Full-time | "Mar 2024 - Present · ..."
        // Pattern B — single-role:
        //   Role | Company · Full-time | "Mar 2024 - Present · ..."
        const durationRE = /^\d+\s*(?:yrs?|mos?|years?|months?)\b/i;
        const dateRE = /^[A-Z][a-z]{2}\s+\d{4}\s*[-–]/i;
        const employmentRE = /^(?:Full-time|Part-time|Contract|Internship|Freelance|Self-employed|Apprenticeship|Permanent|Seasonal)$/i;

        // Heuristic: lines[0] is either Company (Pattern A) or Role (Pattern B).
        // Pattern A: lines[1] is a duration → lines[0] = company, find role next.
        // Pattern B: lines[1] is "Company · Employment-type" → split it.
        const cand0 = expLines[0];
        const cand1 = expLines[1] || '';
        if (cand0 && cand1) {
          if (durationRE.test(cand1)) {
            // Pattern A
            if (!company) company = cand0;
            for (let i = 2; i < Math.min(expLines.length, 10); i++) {
              const l = expLines[i];
              if (durationRE.test(l) || dateRE.test(l) || employmentRE.test(l)) continue;
              if (/^\d/.test(l)) continue;
              if (!position) { position = l; }
              break;
            }
          } else {
            // Pattern B (assume cand0 is role, cand1 contains company)
            if (!position) position = cand0;
            // cand1 might be "Wolf Financial · Full-time"
            const co = cand1.split(/\s*·\s*/)[0].trim();
            if (co && !employmentRE.test(co) && !company) company = co;
          }
        }
      }
    }

    // SECONDARY: parse from the headline (covers cases without Experience).
    if ((!company || !position) && headline) {
      const segs = headline.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
      for (const seg of segs) {
        const mm = seg.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
        if (mm) {
          if (!position) position = mm[1].trim();
          if (!company) company = mm[2].trim().split(/\s*[·•,]\s*/)[0].trim();
          break;
        }
      }
      if (!position && !company) {
        if (segs.length >= 2) { company = segs[0]; position = segs[1]; }
        else if (segs.length === 1) { position = segs[0]; }
      }
    }
    // TERTIARY: any /company/ link inside <main>.
    if (!company) {
      const link = document.querySelector('main a[href*="/company/"]');
      if (link) {
        const txt = ((link.innerText || '').trim().split('\n')[0] || '').trim();
        if (txt && txt.length < 80 && !/^\d/.test(txt)) company = txt;
      }
    }

    const result = {
      firstName, lastName, fullName, headline, company, position,
      linkedinUrl: location.href.split('?')[0],
    };
    console.log('[Bibix Profile Extract]', {
      title: document.title,
      metaDesc: (document.querySelector('meta[name="description"]') || {}).content
        || (document.querySelector('meta[property="og:description"]') || {}).content,
      result,
    });
    return result;
  }

  function isBulkConnectPage() {
    // Pages where LinkedIn shows lots of Connect buttons in a list format.
    return /^\/(search|mynetwork)\//.test(location.pathname);
  }

  function injectFindContactButton() {
    // Manage the Bulk Connect floating button independently.
    if (isBulkConnectPage()) {
      if (!document.getElementById('bibix-floating-connect')) {
        const connectBtn = el('button', {
          id: 'bibix-floating-connect',
          className: FIND_BTN_CLASS,
          type: 'button',
          title: 'Bulk-send connection requests to results on this page',
          style: {
            position: 'fixed',
            top: '90px',
            right: '24px',
            zIndex: '2147483646',
            padding: '12px 18px',
            fontSize: '14px',
            background: 'linear-gradient(135deg, #0a66c2, #0059b3)',
            boxShadow: '0 2px 6px rgba(10, 102, 194, 0.35)',
          },
          onClick: (e) => { e.preventDefault(); e.stopPropagation(); openBulkConnectDialog(); },
        }, [el('span', { className: 'bibix-spark' }, '🤝'), 'Bulk Connect']);
        document.body.appendChild(connectBtn);
      }
    } else {
      const conn = document.getElementById('bibix-floating-connect');
      if (conn) conn.remove();
    }

    if (!isProfilePage()) {
      // Navigating away — remove any floating buttons we injected.
      const find = document.getElementById('bibix-floating-find');
      const save = document.getElementById('bibix-floating-save');
      if (find) find.remove();
      if (save) save.remove();
      return;
    }
    // Vertical stack of floating action buttons in the top-right.
    if (!document.getElementById('bibix-floating-save')) {
      const saveBtn = el('button', {
        id: 'bibix-floating-save',
        className: FIND_BTN_CLASS,
        type: 'button',
        title: 'Save this profile as a candidate in Monday',
        style: {
          position: 'fixed',
          top: '90px',
          right: '24px',
          zIndex: '2147483646',
          padding: '12px 18px',
          fontSize: '14px',
          background: 'linear-gradient(135deg, #4338ca, #6366f1)',
          boxShadow: '0 2px 6px rgba(67, 56, 202, 0.35)',
        },
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); openSaveCandidateDialog(); },
      }, [el('span', { className: 'bibix-spark' }, '💾'), 'Save Contact']);
      document.body.appendChild(saveBtn);
    }
    if (!document.getElementById('bibix-floating-find')) {
      const findBtn = el('button', {
        id: 'bibix-floating-find',
        className: FIND_BTN_CLASS,
        type: 'button',
        title: 'Find this person\'s email via Hunter.io',
        style: {
          position: 'fixed',
          top: '142px',
          right: '24px',
          zIndex: '2147483646',
          padding: '12px 18px',
          fontSize: '14px',
        },
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); openFindContactDialog(); },
      }, [el('span', { className: 'bibix-spark' }, '✨'), 'Find Email']);
      document.body.appendChild(findBtn);
    }
  }

  // ── LinkedIn's own Contact-Info modal — phone, email, website, etc. that
  // the person chose to publish. Free, unlimited, no third-party API.
  async function scrapeContactInfo() {
    const out = { email: '', phone: '', website: '', twitter: '', address: '' };
    // Strategy 1 — if the contact-info section is already in the DOM
    // (sometimes pre-rendered), parse it directly.
    let modal = document.querySelector('#contact-info, [aria-label*="Contact info" i], section[class*="pv-contact-info"]');

    if (!modal) {
      // Strategy 2 — click the "Contact info" link on the profile to open
      // the modal, then read it. Restore the URL when done.
      const startUrl = location.href;
      const link = Array.from(document.querySelectorAll('a, button')).find((el) => {
        const t = (el.innerText || '').trim().toLowerCase();
        const h = (el.getAttribute('href') || '').toLowerCase();
        return t === 'contact info' || /overlay\/contact-info/.test(h)
          || /contact info/i.test(el.getAttribute('aria-label') || '');
      });
      if (!link) return out;
      link.click();
      // Wait for the modal to mount.
      for (let i = 0; i < 25; i++) {
        modal = document.querySelector('#contact-info, [aria-label*="Contact info" i], section[class*="pv-contact-info"], div[role="dialog"]:has(h2)');
        if (modal && (modal.innerText || '').toLowerCase().includes('contact info')) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      if (!modal) {
        // Restore url just in case it changed
        try { history.replaceState(null, '', startUrl); } catch (_) {}
        return out;
      }
    }

    // Parse the modal's innerText. Format usually looks like:
    //   Contact Info
    //   <linkedin-url>
    //   Email
    //   foo@bar.com
    //   Phone
    //   +1 555 123 4567 (Work)
    //   Website
    //   https://...
    const text = (modal.innerText || '').replace(/\r/g, '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    function valueAfterLabel(label) {
      const idx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
      if (idx < 0 || idx + 1 >= lines.length) return '';
      // The next non-empty line is the value; sometimes followed by a "(Type)" line.
      return lines[idx + 1].replace(/\s*\((Work|Home|Mobile|Personal)\)\s*$/i, '').trim();
    }

    out.email = valueAfterLabel('Email');
    out.phone = valueAfterLabel('Phone');
    out.website = valueAfterLabel('Website');
    out.twitter = valueAfterLabel('Twitter');
    out.address = valueAfterLabel('Address');

    // Even if the labels are localized, fall back to regex match across the
    // whole text for phone (digits + format) and email (@).
    if (!out.email) {
      const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      if (m) out.email = m[0];
    }
    if (!out.phone) {
      const m = text.match(/(\+?\d[\d\s\-().]{7,}\d)/);
      if (m) out.phone = m[1].trim();
    }

    // Close the modal: press Escape or click the close button.
    try {
      const closeBtn = modal.querySelector('button[aria-label*="Dismiss" i], button[aria-label*="Close" i]');
      if (closeBtn) closeBtn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    } catch (_) {}
    // Restore URL if it changed (the contact-info modal sometimes navigates).
    if (location.href !== location.href.split('?')[0]) {
      try { history.replaceState(null, '', location.href.split('?')[0]); } catch (_) {}
    }

    return out;
  }

  function openSaveCandidateDialog() {
    closePopover();
    const info = extractProfileInfo();
    const pop = document.createElement('dialog');
    pop.className = 'bibix-popover';
    Object.assign(pop.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      margin: '0', padding: '20px', background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      width: '480px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', color: '#1f2937', zIndex: '2147483647',
    });
    pop.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;background:linear-gradient(135deg,#4338ca,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent">
        💾 Save as Candidate
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">
        Saves this profile to your Monday → LinkedIn → Candidates list.
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:#64748b;margin-bottom:3px">Full name</div>
        <input id="bsc-name" value="${(info.fullName || '').replace(/"/g, '&quot;')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:#64748b;margin-bottom:3px">Current company</div>
        <input id="bsc-company" value="${(info.company || '').replace(/"/g, '&quot;')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:#64748b;margin-bottom:3px">Current position</div>
        <input id="bsc-position" value="${(info.position || '').replace(/"/g, '&quot;')}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">Email</div>
          <input id="bsc-email" value="" placeholder="auto-filled from LinkedIn if shared" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">Phone</div>
          <input id="bsc-phone" value="" placeholder="auto-filled from LinkedIn if shared" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;box-sizing:border-box">
        </div>
      </div>
      <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <button id="bsc-pull-li" type="button" style="background:#eef2ff;color:#4338ca;border:1px solid #c7d2fe;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">📞 Pull phone/email from LinkedIn Contact Info</button>
        <span id="bsc-pull-status" style="font-size:11px;color:#94a3b8"></span>
      </div>
      <div style="margin-bottom:14px;font-size:11px;color:#94a3b8">
        LinkedIn URL: <span style="color:#475569">${info.linkedinUrl}</span>
      </div>
      <div id="bsc-status" style="font-size:12px;min-height:18px;margin-bottom:10px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="bsc-close" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Cancel</button>
        <button id="bsc-save" style="background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Save Candidate</button>
      </div>
    `;
    document.documentElement.appendChild(pop);
    try { pop.showModal(); } catch (_) {}
    activeDialog = pop;
    activePopover = pop;

    const status = pop.querySelector('#bsc-status');
    const pullStatus = pop.querySelector('#bsc-pull-status');
    pop.querySelector('#bsc-close').addEventListener('click', () => closePopover());
    pop.addEventListener('click', (e) => { if (e.target === pop) closePopover(); });

    pop.querySelector('#bsc-pull-li').addEventListener('click', async () => {
      pullStatus.textContent = 'opening contact info…';
      try {
        const ci = await scrapeContactInfo();
        if (ci.email && !pop.querySelector('#bsc-email').value) pop.querySelector('#bsc-email').value = ci.email;
        if (ci.phone && !pop.querySelector('#bsc-phone').value) pop.querySelector('#bsc-phone').value = ci.phone;
        const filled = [];
        if (ci.email) filled.push('email');
        if (ci.phone) filled.push('phone');
        if (ci.website) filled.push('website');
        pullStatus.textContent = filled.length
          ? `✓ Filled ${filled.join(' + ')}`
          : 'No public phone/email on this profile.';
      } catch (e) {
        pullStatus.textContent = 'Could not open contact info.';
      }
    });

    pop.querySelector('#bsc-save').addEventListener('click', async () => {
      const fullName = pop.querySelector('#bsc-name').value.trim();
      const company = pop.querySelector('#bsc-company').value.trim();
      const position = pop.querySelector('#bsc-position').value.trim();
      const email = pop.querySelector('#bsc-email').value.trim();
      const phone = pop.querySelector('#bsc-phone').value.trim();
      if (!fullName) { status.innerHTML = '<span style="color:#ef4444">Full name required</span>'; return; }
      status.innerHTML = '<span style="color:#64748b">Saving…</span>';
      const parts = fullName.split(/\s+/);
      const res = await send('saveCandidate', {
        fullName,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' '),
        company, position,
        email, phone,
        headline: info.headline,
        linkedinUrl: info.linkedinUrl,
      });
      if (res.ok) {
        status.innerHTML = `<span style="color:#10b981">✓ ${res.data.updated ? 'Updated' : 'Saved'} candidate.</span>`;
        setTimeout(() => closePopover(), 1200);
      } else {
        status.innerHTML = `<span style="color:#ef4444">${res.error || 'save failed'}</span>`;
      }
    });
  }

  // ── Bulk Connect ──────────────────────────────────────────────────────────
  //
  // LinkedIn's current DOM (mid-2026) renders the "Connect" action as an
  // <a> element, not a <button>. Class names are fully obfuscated but the
  // aria-label is always "Invite <Full Name> to connect". Query both tags.
  function findConnectButtons() {
    const out = [];
    document.querySelectorAll('button, a').forEach((el) => {
      if (el.disabled) return;
      if (el.offsetHeight === 0) return;
      const label = (el.getAttribute('aria-label') || '').trim();
      const text  = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      const combined = (label + ' | ' + text).toLowerCase();

      // Positive: canonical "Invite X to connect" aria-label pattern,
      // OR the visible text is exactly "Connect".
      const isConnect =
        /\binvite\b.+\bto connect\b/i.test(label)
        || /^connect$/i.test(text)
        || /^\+?\s*connect$/i.test(text);
      if (!isConnect) return;

      // Negative — pending / withdraw / follow / message / cancel / remove
      // all use different aria-labels so a Pending anchor won't slip through
      // the positive match; guard anyway.
      if (/\bpending\b|\bwithdraw\b|\bfollowing\b|\bmessage(?:d)?\b|\bremove\b|\bcancel\b/i.test(combined)) return;
      if (text.toLowerCase() === 'follow') return;

      out.push(el);
    });
    return out;
  }

  function extractPersonNearConnect(btn) {
    // Primary — pull the name straight out of the aria-label:
    // "Invite Constantinos Hadjiandreou to connect" → "Constantinos Hadjiandreou"
    let name = '';
    const label = btn.getAttribute && btn.getAttribute('aria-label');
    if (label) {
      const m = label.match(/^invite\s+(.+?)\s+to connect\b/i);
      if (m) name = m[1].trim();
    }
    // Walk up looking for a search-result card that has a profile link.
    let card = btn;
    let url = '';
    let headline = '';
    for (let i = 0; i < 15 && card && card !== document.body; i++) {
      const link = card.querySelector('a[href*="/in/"]');
      if (link) {
        url = link.href.split('?')[0];
        if (!name) {
          name = (link.innerText || '').trim().split('\n')[0].trim()
            .replace(/\s*[·•]\s*\d+(?:st|nd|rd|th)?\s*(?:degree|connection)?.*$/i, '')
            .trim();
        }
        const lines = (card.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean);
        const nameIdx = name ? lines.findIndex((l) => l.startsWith(name)) : -1;
        const start = nameIdx >= 0 ? nameIdx + 1 : 0;
        for (let j = start; j < Math.min(start + 5, lines.length); j++) {
          const l = lines[j];
          if (/(1st|2nd|3rd|degree|connection|mutual|follower)/i.test(l)) continue;
          if (l.length < 5) continue;
          headline = l;
          break;
        }
        break;
      }
      card = card.parentElement;
    }
    if (!name && !url) return null;
    return { name: name || 'Unknown', url, headline };
  }

  async function findButton(timeoutMs, predicate) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // Query button AND a — LinkedIn renders many action controls as <a>.
      const btns = document.querySelectorAll('button, a, [role="button"]');
      for (const b of btns) {
        try {
          if (b.offsetHeight === 0) continue;
          if (predicate(b)) return b;
        } catch (_) {}
      }
      await wait(150);
    }
    return null;
  }

  function openBulkConnectDialog() {
    closePopover();
    const pop = document.createElement('dialog');
    pop.className = 'bibix-popover';
    Object.assign(pop.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      margin: '0', padding: '20px', background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      width: '460px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', color: '#1f2937', zIndex: '2147483647',
    });
    pop.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;background:linear-gradient(135deg,#0a66c2,#0059b3);-webkit-background-clip:text;background-clip:text;color:transparent">
        🤝 Bulk Connect
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">
        Sends connection requests to people on this page, with random 5–15s delays.
        Saves each to your Candidates list automatically.
      </div>
      <div style="margin-bottom:10px;padding:10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:11px;color:#9a3412">
        ⚠️ LinkedIn caps connection requests at ~100/week (free) or ~200/week (Premium).
        Keep sessions small.
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
        <input id="bc-count" type="number" min="1" max="20" value="5" style="width:70px;padding:8px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
        <span style="font-size:12px;color:#64748b">people (max 20)</span>
      </div>
      <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#64748b;margin-bottom:14px">
        <input id="bc-showall" type="checkbox" checked />
        Click "Show all" first to load full people-results page
      </label>
      <div id="bc-status" style="font-size:12px;min-height:36px;margin-bottom:10px;color:#475569"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="bc-close" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Close</button>
        <button id="bc-go" style="background:linear-gradient(135deg,#0a66c2,#0059b3);color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Start connecting</button>
      </div>
    `;
    document.documentElement.appendChild(pop);
    try { pop.showModal(); } catch (_) {}
    activeDialog = pop;
    activePopover = pop;

    const status = pop.querySelector('#bc-status');
    const setStatus = (s) => { if (status) status.textContent = s; };

    pop.querySelector('#bc-close').addEventListener('click', () => { bulkAborted = true; closePopover(); });
    pop.addEventListener('click', (e) => { if (e.target === pop) { bulkAborted = true; closePopover(); } });
    pop.querySelector('#bc-go').addEventListener('click', async () => {
      bulkAborted = false;
      const n = Math.max(1, Math.min(20, Number(pop.querySelector('#bc-count').value) || 5));
      const goShowAll = pop.querySelector('#bc-showall').checked;
      await runBulkConnect(n, goShowAll, setStatus);
    });
  }

  // Listener for messages from the extension popup.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'bibix-start-bulk-connect') {
        bulkAborted = false;
        const count = Math.max(1, Math.min(20, Number(msg.count) || 5));
        const push = (text, opts = {}) => {
          try { chrome.runtime.sendMessage({ type: 'bibix-bulk-connect-progress', text, ...opts }); } catch (_) {}
        };
        runBulkConnect(count, true, (s) => push(s))
          .then((final) => push(final || 'Done.', { done: true }))
          .catch((e) => push('Error: ' + (e && e.message), { error: true }));
        sendResponse({ ok: true });
        return true;
      }
      // Outreach: send ONE personalized connection request on the current profile.
      if (msg && msg.type === 'bibix-outreach-connect') {
        connectOnCurrentProfile(msg.note || '')
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ ok: false, status: 'failed', error: (e && e.message) || 'error' }));
        return true; // async
      }
    });
  } catch (_) {}

  // Send a connection request to the person whose profile is currently open,
  // optionally with a personalized note. Reuses the bulk-connect primitives.
  async function connectOnCurrentProfile(note) {
    const P = '[Bibix Outreach]';
    const topCard = () => document.querySelector('main section, .pv-top-card, [class*="pv-top-card"]') || document.querySelector('main') || document.body;
    const closeDialog = () => {
      try {
        const dlg = document.querySelector('div[role="dialog"]');
        const c = dlg && dlg.querySelector('button[aria-label*="Dismiss" i], button[aria-label*="Close" i]');
        if (c) c.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
      } catch (_) {}
    };
    const isEmailGate = (dlg) => {
      if (!dlg) return false;
      if (dlg.querySelector('input[type="email"], input#email, input[name="email"]')) return true;
      return /enter .*email|email address|verify .*member|that .*knows you/i.test(dlg.innerText || '');
    };
    const pendingNow = () => Array.from(document.querySelectorAll('button')).some((b) => /^pending$/i.test((b.innerText || '').trim()));

    // 1. Find the Connect button in the profile's TOP CARD (not the rails).
    let btn = null;
    for (let i = 0; i < 24; i++) {
      const card = topCard();
      btn = Array.from(card.querySelectorAll('button')).find((b) => {
        if (b.disabled || b.offsetHeight === 0) return false;
        const l = (b.getAttribute('aria-label') || '');
        const t = (b.innerText || '').trim();
        if (/pending|message|following|remove/i.test((l + ' ' + t).toLowerCase())) return false;
        return /invite .+ to connect/i.test(l) || /^connect$/i.test(t);
      });
      if (btn) break;
      await wait(300);
    }
    // 2. Buried under "More actions".
    if (!btn) {
      const more = await findButton(3500, (b) => {
        const l = (b.getAttribute('aria-label') || '').toLowerCase();
        const t = (b.innerText || '').trim().toLowerCase();
        return /more actions/i.test(l) || t === 'more';
      });
      if (more) {
        realisticClick(more);
        await wait(rand(700, 1100));
        btn = await findButton(3000, (b) => {
          const t = (b.innerText || b.textContent || '').trim();
          const l = (b.getAttribute('aria-label') || '');
          if (/\bpending\b|\bremove\b|\bfollowing\b|\bmessage\b/i.test((l + ' ' + t).toLowerCase())) return false;
          return /to connect/i.test(l) || /^connect$/i.test(t);
        });
      }
    }
    if (!btn) {
      if (pendingNow()) return { ok: false, status: 'skipped', error: 'Invite already pending' };
      return { ok: false, status: 'skipped', error: 'No Connect option (already connected, or LinkedIn hides Connect for this profile)' };
    }

    highlightBriefly(btn, '#dc2626');
    realisticClick(btn);

    // 3. Wait for the invite dialog — or an instant send (button flips to Pending).
    let dlg = null;
    for (let i = 0; i < 24; i++) {
      dlg = document.querySelector('div[role="dialog"]');
      if (dlg) break;
      if (pendingNow()) return { ok: true, status: 'invited', note: false };
      await wait(250);
    }
    if (!dlg) {
      if (pendingNow()) return { ok: true, status: 'invited', note: false };
      return { ok: false, status: 'failed', error: 'No invite dialog appeared after clicking Connect' };
    }

    // 4. Out-of-network: LinkedIn demands their email — can't send on a free account.
    if (isEmailGate(dlg)) {
      closeDialog();
      return { ok: false, status: 'skipped', error: 'LinkedIn requires their email (out-of-network — can’t invite on a free account)' };
    }

    const inDlg = (pred) => Array.from((document.querySelector('div[role="dialog"]') || dlg).querySelectorAll('button'))
      .find((b) => { try { return b.offsetHeight > 0 && !b.disabled && pred(b); } catch (_) { return false; } });

    // 5. With a note: open note field, type, then Send.
    if (note && note.trim()) {
      const addNote = inDlg((b) => {
        const t = (b.innerText || '').trim().toLowerCase();
        const l = (b.getAttribute('aria-label') || '').toLowerCase();
        return t === 'add a note' || l === 'add a note';
      });
      if (addNote) { realisticClick(addNote); await wait(rand(600, 1000)); }
      const ta = (document.querySelector('div[role="dialog"]') || dlg).querySelector('textarea#custom-message, textarea[name="message"], textarea');
      if (ta) {
        try {
          ta.focus();
          const text = note.trim().slice(0, 300); // LinkedIn free-note cap
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, text);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(rand(400, 800));
        } catch (_) {}
      }
    }

    // 6. Click Send (with or without note) — scoped to the dialog.
    let sendBtn = inDlg((b) => {
      const t = (b.innerText || '').trim().toLowerCase();
      const l = (b.getAttribute('aria-label') || '').toLowerCase();
      if (t === 'add a note') return false;
      return /^send( invitation| now)?$/i.test(t) || /^send without a note$/i.test(t)
        || /send (invitation|now)/i.test(l) || /send without a note/i.test(l);
    });
    if (!sendBtn) sendBtn = inDlg((b) => (b.innerText || '').trim().toLowerCase().startsWith('send'));
    if (sendBtn) {
      highlightBriefly(sendBtn, '#0a66c2');
      realisticClick(sendBtn);
      await wait(rand(800, 1400));
      return { ok: true, status: 'invited', note: !!(note && note.trim()) };
    }

    console.warn(P, 'no Send button in dialog');
    closeDialog();
    return { ok: false, status: 'failed', error: 'Invite dialog had no Send button (layout/locale changed)' };
  }

  function realisticClick(btn) {
    // Some LinkedIn buttons need a full mousedown/mouseup/click sequence.
    try {
      btn.scrollIntoView({ block: 'center' });
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
      btn.dispatchEvent(new MouseEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new MouseEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
      btn.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {
      try { btn.click(); } catch (_) {}
    }
  }

  function findNextPageButton() {
    const buttons = Array.from(document.querySelectorAll('button, a'));
    return buttons.find((b) => {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text  = (b.innerText || '').trim().toLowerCase();
      if (b.disabled) return false;
      return label === 'next' || text === 'next'
        || /^next\b/i.test(label) || /^next\s*(page|→|›)$/i.test(text);
    });
  }

  function highlightBriefly(el, color = '#dc2626') {
    if (!el) return;
    const origOutline = el.style.outline;
    const origOffset  = el.style.outlineOffset;
    const origBoxShadow = el.style.boxShadow;
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = '2px';
    el.style.boxShadow = `0 0 20px ${color}`;
    setTimeout(() => {
      el.style.outline = origOutline;
      el.style.outlineOffset = origOffset;
      el.style.boxShadow = origBoxShadow;
    }, 900);
  }

  async function runBulkConnect(count, _clickShowAll, setStatus) {
    const P = '[Bibix Connect]';
    // Simple: find all visible Connect buttons on this page, click each with
    // a red highlight, handle the "Send" modal, wait 5–10s between clicks.
    // No pagination, no navigation.

    setStatus('Scanning for Connect buttons…');
    let btns = findConnectButtons();
    // Small scroll to trigger any lazy-loading of results.
    if (btns.length === 0) {
      window.scrollTo(0, 400);
      await wait(600);
      btns = findConnectButtons();
    }
    console.log(P, `page: ${btns.length} Connect buttons visible`);

    if (btns.length === 0) {
      const msg = 'No Connect buttons found. Open a "People" search results page (e.g. linkedin.com/search/results/people/?keywords=…) and reload the tab.';
      setStatus(msg);
      return msg;
    }

    const targets = btns.slice(0, count);
    setStatus(`Found ${btns.length} Connect buttons. Will click ${targets.length}.`);
    await wait(800);

    let done = 0, errors = 0;
    for (let i = 0; i < targets.length; i++) {
      if (bulkAborted) {
        const msg = `Stopped. Sent ${done}/${targets.length}.`;
        setStatus(msg);
        return msg;
      }
      const btn = targets[i];
      const person = extractPersonNearConnect(btn);
      const label = person ? person.name : `#${i + 1}`;

      try {
        // 1. Scroll button into view so the user actually sees it.
        btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
        await wait(rand(600, 900));
        // 2. Flash a red outline so the user sees exactly which button we're clicking.
        highlightBriefly(btn, '#dc2626');
        setStatus(`${i + 1}/${targets.length} — clicking Connect on ${label}…`);
        await wait(400);
        // 3. Fire the click.
        realisticClick(btn);
        console.log(P, `clicked Connect for ${label}`);
        // 4. If the "Add a note?" dialog appears, click Send without a note.
        const sendBtn = await findButton(5000, (b) => {
          if (b.disabled) return false;
          const l = (b.getAttribute('aria-label') || '').toLowerCase().trim();
          const t = (b.innerText || b.textContent || '').toLowerCase().trim();
          // Skip the "Add a note" option — we always want to send without one.
          if (t === 'add a note' || l === 'add a note') return false;
          if (/^send without a note$/i.test(t)) return true;
          if (/^send without a note$/i.test(l)) return true;
          if (t === 'send now' || t === 'send') return true;
          if (/send.*invitation/i.test(l)) return true;
          return false;
        });
        if (sendBtn) {
          highlightBriefly(sendBtn, '#0a66c2');
          setStatus(`${i + 1}/${targets.length} — sending invitation…`);
          await wait(rand(400, 800));
          realisticClick(sendBtn);
          console.log(P, `sent invitation for ${label}`);
        }
        // 5. Save to backend.
        if (person && person.url) {
          try {
            await send('saveCandidate', {
              fullName: person.name || 'Unknown',
              firstName: (person.name || '').split(' ')[0] || '',
              lastName: (person.name || '').split(' ').slice(1).join(' '),
              headline: person.headline || '',
              linkedinUrl: person.url,
              source: 'bulk_connect',
            });
          } catch (_) {}
        }
        done++;
      } catch (e) {
        errors++;
        console.warn(P, 'error on', label, ':', e.message);
      }

      // 5–10s pause between clicks (humanlike).
      if (i < targets.length - 1) {
        const pause = rand(5000, 10000);
        setStatus(`✓ Sent ${done}/${targets.length}. Waiting ${Math.round(pause/1000)}s…`);
        await wait(pause);
      }
    }

    const finalMsg = `Done. ${done} connection requests sent${errors ? `, ${errors} skipped` : ''}.`;
    setStatus(finalMsg);
    return finalMsg;
  }

  // Retained for interface compatibility with older callers.
  async function _oldRunBulkConnect(count, clickShowAll, setStatus) {
    const P = '[Bibix Connect]';
    // Step 1 — if on a mixed /search/results/all page and user requested it,
    // navigate to the People-specific results.
    if (clickShowAll && /\/search\/results\/all\//.test(location.pathname)) {
      const showAll = Array.from(document.querySelectorAll('a, button')).find((el) => {
        const t = (el.innerText || '').trim();
        return /^Show all(\s+results)?$/i.test(t) || /^See all/i.test(t);
      });
      if (showAll) {
        setStatus('Opening full people results…');
        showAll.click();
        await wait(3000);
      }
    }

    let done = 0, errors = 0, pageNum = 1;
    const target = count;

    // Loop over pages until we hit the target or run out.
    while (done < target && pageNum <= 10) {
      setStatus(`Page ${pageNum} — scanning for Connect buttons…`);

      // Scroll to load lazy-rendered results on this page.
      let btns = findConnectButtons();
      for (let i = 0; i < 4 && btns.length < (target - done); i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await wait(rand(1000, 1800));
        btns = findConnectButtons();
      }
      console.log(P, `page ${pageNum}: ${btns.length} Connect buttons visible`);
      setStatus(`Page ${pageNum}: found ${btns.length} Connect buttons.`);

      if (btns.length === 0) {
        // Detection failed on this page. Don't blindly paginate — that just
        // navigates without ever clicking Connect and the user sees "the
        // page keeps refreshing".
        const msg = pageNum === 1
          ? 'No Connect buttons found. Are you on a People search results page?'
          : `Page ${pageNum} has no Connect buttons — stopping.`;
        setStatus(msg);
        return msg;
      } else {
        // Randomise + trim to remaining need.
        btns = shuffle(btns).slice(0, target - done);
        setStatus(`Page ${pageNum}: connecting to ${btns.length} people…`);

        for (let i = 0; i < btns.length; i++) {
          if (bulkAborted) { setStatus(`Stopped. Sent ${done}, skipped ${errors}.`); return `Stopped. ${done} sent.`; }
          const btn = btns[i];
          const person = extractPersonNearConnect(btn);
          const label = person ? person.name : `#${i + 1}`;
          setStatus(`Page ${pageNum} · ${done + 1}/${target} — ${label}…`);

          try {
            realisticClick(btn);
            // If LinkedIn shows the "Add a note?" dialog, click Send/Send-without.
            const sendBtn = await findButton(4500, (b) => {
              if (b.disabled) return false;
              const l = (b.getAttribute('aria-label') || '').toLowerCase();
              const t = (b.innerText || '').trim().toLowerCase();
              return /send.*(invitation|now|without)/i.test(l)
                || /send without a note/i.test(t)
                || t === 'send now'
                || t === 'send';
            });
            if (sendBtn) {
              await wait(rand(200, 500));
              realisticClick(sendBtn);
            }
            if (person && person.url) {
              try {
                await send('saveCandidate', {
                  fullName: person.name || 'Unknown',
                  firstName: (person.name || '').split(' ')[0] || '',
                  lastName: (person.name || '').split(' ').slice(1).join(' '),
                  headline: person.headline || '',
                  linkedinUrl: person.url,
                  source: 'bulk_connect',
                });
              } catch (_) {}
            }
            done++;
          } catch (e) {
            errors++;
            console.warn(P, 'error:', e.message);
          }

          if (done < target && i < btns.length - 1) await wait(rand(5000, 15000));
        }
      }

      if (done >= target) break;

      // Try to advance to the next page.
      const nextBtn = findNextPageButton();
      if (!nextBtn) {
        setStatus(`No "Next" page found. Sent ${done}/${target}.`);
        break;
      }
      setStatus(`Loading page ${pageNum + 1}…`);
      realisticClick(nextBtn);
      pageNum++;
      // Wait for the new page's results to mount + delay to look human.
      await wait(rand(3500, 6000));
      window.scrollTo(0, 0);
      await wait(500);
    }

    const finalMsg = `Done. ${done} requests sent${errors ? `, ${errors} skipped` : ''}. Saved to Candidates.`;
    setStatus(finalMsg);
    return finalMsg;
  }

  function openFindContactDialog() {
    closePopover();
    const info = extractProfileInfo();
    const pop = document.createElement('dialog');
    pop.className = 'bibix-popover';
    Object.assign(pop.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      margin: '0', padding: '20px', background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      width: '460px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)',
      overflow: 'auto', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px', color: '#1f2937', zIndex: '2147483647',
    });
    pop.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;background:linear-gradient(135deg,#4338ca,#6366f1);-webkit-background-clip:text;background-clip:text;color:transparent">
        ✨ Find Contact — Hunter.io
      </div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">
        We'll use first/last name + company to find a likely work email.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">First name</div>
          <input id="bfc-first" value="${(info.firstName || '').replace(/"/g, '&quot;')}" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
        </div>
        <div>
          <div style="font-size:11px;color:#64748b;margin-bottom:3px">Last name</div>
          <input id="bfc-last" value="${(info.lastName || '').replace(/"/g, '&quot;')}" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:#64748b;margin-bottom:3px">Company</div>
        <input id="bfc-company" value="${(info.company || '').replace(/"/g, '&quot;')}" placeholder="e.g. Stripe" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:11px;color:#64748b;margin-bottom:3px">Company domain <span style="color:#94a3b8">(optional, more accurate)</span></div>
        <input id="bfc-domain" placeholder="e.g. stripe.com" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
      </div>
      <div id="bfc-result" style="min-height:30px;margin-bottom:10px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button id="bfc-close" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Close</button>
        <button id="bfc-find" style="background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">Find email</button>
      </div>
    `;
    document.documentElement.appendChild(pop);
    try { pop.showModal(); } catch (_) {}
    activeDialog = pop;
    activePopover = pop;

    const resultDiv = pop.querySelector('#bfc-result');
    pop.querySelector('#bfc-close').addEventListener('click', () => closePopover());
    pop.addEventListener('click', (e) => { if (e.target === pop) closePopover(); });

    pop.querySelector('#bfc-find').addEventListener('click', async () => {
      const firstName = pop.querySelector('#bfc-first').value.trim();
      const lastName = pop.querySelector('#bfc-last').value.trim();
      const company = pop.querySelector('#bfc-company').value.trim();
      const domain = pop.querySelector('#bfc-domain').value.trim();
      if (!firstName || !lastName) { resultDiv.innerHTML = '<span style="color:#ef4444">First and last name required</span>'; return; }
      if (!company && !domain) { resultDiv.innerHTML = '<span style="color:#ef4444">Company or domain required</span>'; return; }
      resultDiv.innerHTML = '<span style="color:#64748b">Looking up…</span>';
      const res = await send('findEmail', {
        firstName, lastName, company, domain,
        linkedinUrl: info.linkedinUrl, headline: info.headline,
      });
      if (!res.ok) {
        resultDiv.innerHTML = `<span style="color:#ef4444">${res.error || 'lookup failed'}</span>`;
        return;
      }
      const d = res.data || {};
      if (!d.email) {
        resultDiv.innerHTML = '<span style="color:#f59e0b">No email found. Try a different domain.</span>';
        return;
      }
      const confidence = d.score != null ? `${d.score}% confidence` : '';
      const cachedTag = d.cached ? ' <span style="color:#10b981;font-size:10px">(cached)</span>' : '';
      resultDiv.innerHTML = `
        <div style="padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
          <div style="font-weight:600;font-size:14px;color:#1f2937">${d.email}${cachedTag}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">${confidence}${d.position ? ' · ' + d.position : ''}</div>
          <div style="margin-top:10px;display:flex;gap:6px">
            <button id="bfc-copy" style="flex:1;background:#f1f5f9;border:1px solid #e2e8f0;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer">Copy email</button>
            <button id="bfc-tocrm" style="flex:1;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer">Save to Monday CRM</button>
          </div>
          <div id="bfc-crm-status" style="font-size:11px;color:#10b981;margin-top:6px"></div>
        </div>`;
      pop.querySelector('#bfc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(d.email);
        pop.querySelector('#bfc-copy').textContent = 'Copied!';
      });
      pop.querySelector('#bfc-tocrm').addEventListener('click', async () => {
        const status = pop.querySelector('#bfc-crm-status');
        status.textContent = 'Saving…';
        const r = await send('contactToCrm', { contactId: d.contactId });
        if (r.ok) status.textContent = `Saved as CRM contact #${r.data.contactNum}.`;
        else status.textContent = 'Save failed: ' + (r.error || '');
      });
    });
  }

  let scanTimer = null;
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 200); }

  document.addEventListener('focusin', (e) => {
    if (e.target && e.target.matches && e.target.matches('[contenteditable="true"]')) {
      scheduleScan();
    }
  }, true);

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScan();
  // Re-scan a few times during initial page load — LinkedIn's SPA mounts
  // post DOM in waves, and we want buttons to appear without waiting for
  // user interaction.
  setTimeout(scheduleScan, 500);
  setTimeout(scheduleScan, 1500);
  setTimeout(scheduleScan, 3500);

  console.log('[Bibix LinkedIn AI] content script loaded (v0.5.6)');
  // Periodic count log to aid debugging in production.
  setInterval(() => {
    const n = document.querySelectorAll('.' + BTN_CLASS).length;
    if (n > 0) return; // only log when zero, to surface visibility issues
    const editors = document.querySelectorAll('[contenteditable="true"]').length;
    if (editors > 0) console.log('[Bibix LinkedIn AI] No buttons injected — editors on page:', editors);
  }, 5000);
})();
