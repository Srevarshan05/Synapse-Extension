/**
 * Synapse v3 — Capture Engine (Raw Fidelity Mode)
 *
 * Pipeline:
 *   discover → scroll-load → extract → stage
 *
 * Principles:
 *   - NEVER summarize, prune, or compress before sending.
 *   - NEVER build graphs or compile memory layers.
 *   - Raw messages go to the companion server exactly as extracted from the DOM.
 *   - Scroll fully through the conversation to capture every message.
 *   - Completeness = messages staged / messages seen.
 *
 * Changes from v2:
 *   - getBase64FromImageUrl(): fixed incorrect same-origin check.
 *     Old code used url.includes(window.location.hostname) which caused
 *     CDN URLs (e.g. files.oaiusercontent.com) to be attempted as
 *     same-origin fetches, producing CORS errors before falling through
 *     to the background proxy (adding unnecessary 1–3s latency per image).
 *     New code compares URL origins via the URL constructor.
 *
 *   - Message schema: `artifacts` array is now preserved from adapters
 *     that support it (currently ClaudeAdapter). If an adapter does not
 *     provide artifacts the field defaults to [].
 *
 *   - `citations` array is preserved from adapters that support it
 *     (currently GeminiAdapter).
 *
 *   - extractImagesFromNode(): turnContainer climbing now also matches
 *     Claude's [data-testid="human-turn"] and [data-testid="ai-turn"].
 */

// ─── Main capture function ────────────────────────────────────────────────────

/**
 * @param {import('../adapters/base.js').BaseAdapter} adapter
 * @param {'fast'|'standard'|'deep'} level
 * @param {{ onProgress?: (state: object) => void }} [opts]
 * @returns {Promise<object>} staged capsule metadata
 */
export async function capture(adapter, level = 'standard', opts = {}) {
  const { onProgress } = opts;
  const log = (...a) => console.log('[Synapse Capture]', ...a);

  const cores   = navigator.hardwareConcurrency || 2;
  const workers = cores <= 2 ? 2 : cores <= 8 ? 4 : 6;
  log(`Starting. level=${level}, cores=${cores}, workers=${workers}`);

  // ── Phase 1: DISCOVER ──────────────────────────────────────────────────────
  progress(onProgress, { phase: 'discover', label: 'Discovering conversation…', step: 1, total: 4 });

  const root = adapter.getChatRoot();
  if (!root) {
    throw new Error(
      'Could not find the conversation container. ' +
      'The page may still be loading — wait a moment and try again.'
    );
  }
  log('Phase 1 discover ✓');

  // ── Phase 2: SCROLL-LOAD FULL CONVERSATION ─────────────────────────────────
  progress(onProgress, { phase: 'loading', label: 'Loading all messages…', step: 2, total: 4 });
  log('Phase 2: progressive scroll load…');

  let maxSeen = 0;
  await adapter.loadFullConversation(count => {
    if (count > maxSeen) {
      maxSeen = count;
      log(`  ${count} messages visible`);
      progress(onProgress, {
        phase: 'loading',
        label: `Loading… ${count} messages found`,
        messagesVisible: count,
        step: 2, total: 4,
      });
    }
  });
  log(`Phase 2 load ✓ — max visible: ${maxSeen}`);

  // ── Phase 3: EXTRACT RAW CONTENT ──────────────────────────────────────────
  progress(onProgress, { phase: 'extract', label: 'Extracting content…', step: 3, total: 4 });
  log('Phase 3: extraction…');

  const rawMessages = adapter.getMessages();
  log(`  Extracted ${rawMessages.length} raw messages`);

  // Keep every field the adapter provides — no pruning whatsoever.
  // Assign a stable id and index; preserve all other adapter fields as-is.
  const messages = [];
  for (let idx = 0; idx < rawMessages.length; idx++) {
    const m = rawMessages[idx];

    // ── Progressive Visual Scroll-into-View ─────────────────────────────────
    // Scroll every message turn progressively into view to trigger lazy-loading
    // of images, dynamic attachments, and ProseMirror assets.
    if (m.node && typeof m.node.scrollIntoView === 'function') {
      try {
        m.node.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        const scrollWaitTime = level === 'fast' ? 50 : 150;
        await new Promise(r => setTimeout(r, scrollWaitTime));
      } catch (e) {
        log(`  Failed to scroll message ${idx} into view:`, e.message);
      }
    }

    const msgId  = `msg-${Date.now()}-${idx}`;
    const images = await extractImagesFromNode(
      m.node, log, msgId, m.role ?? 'unknown', adapter.platformId
    );

    // Discard only if completely empty of text AND images
    if (m.content.trim().length === 0 && images.length === 0) {
      continue;
    }

    messages.push({
      id:         msgId,
      index:      idx,
      role:       m.role       ?? 'unknown',
      content:    m.content    ?? '',
      codeBlocks: m.codeBlocks ?? [],
      tables:     m.tables     ?? [],
      hasMath:    m.hasMath    ?? false,
      hasCode:    (m.codeBlocks?.length ?? 0) > 0,
      images,
      // New fields — preserved only when the adapter provides them
      artifacts:  m.artifacts  ?? [],   // Claude artifacts
      citations:  m.citations  ?? [],   // Gemini citations
      // Preserve any extra adapter fields (rawHtml, nodeType, etc.)
      ...(m.rawHtml  !== undefined ? { rawHtml:  m.rawHtml  } : {}),
      ...(m.nodeType !== undefined ? { nodeType: m.nodeType } : {}),
    });
  }

  const title = extractTitle();
  log(`Phase 3 extract ✓ — ${messages.length} messages`);

  // ── Phase 4: STAGE for background pickup ──────────────────────────────────
  progress(onProgress, { phase: 'stage', label: 'Staging…', step: 4, total: 4 });
  log('Phase 4: staging…');

  const completeness = maxSeen > 0 ? Math.round((messages.length / maxSeen) * 100) : 100;

  // Summary counts for the capture report
  const totalArtifacts = messages.reduce((n, m) => n + (m.artifacts?.length ?? 0), 0);
  const totalCitations = messages.reduce((n, m) => n + (m.citations?.length ?? 0), 0);
  const totalImages    = messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);

  const captureReport = {
    messagesFound:    rawMessages.length,
    messagesCaptured: messages.length,
    completeness,
    lowCompleteness:  completeness < 95,
    workerCount:      workers,
    capturedAt:       Date.now(),
    imagesExtracted:  totalImages,
    artifactsFound:   totalArtifacts,
    citationsFound:   totalCitations,
  };

  if (captureReport.lowCompleteness) {
    log(`  ⚠️ Below 95% completeness — try reloading the page`);
  }

  progress(onProgress, { phase: 'complete', label: 'Capture complete', completeness, step: 4, total: 4 });
  log(`Phase 4 stage ✓ — ${messages.length} messages, ${completeness}% complete`);

  // ── Assemble minimal capsule object ────────────────────────────────────────
  const capsule = {
    id:           `cap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    schemaVersion: 3,
    platform:      adapter.platformId,
    createdAt:     Date.now(),
    title,
    captureLevel:  level,

    // Flat ordered raw message array — the single source of truth
    conversation: {
      messages,
      totalCount: messages.length,
    },

    // Empty stubs — no graph, no memory layers
    graph:       null,
    memory:      null,
    code:        { snippets: [] },
    attachments: [],

    captureReport,
    security: { redacted: false, encryptionMode: 'auto' },
  };

  log(`Capture complete ✅ — ${messages.length} messages, ${completeness}% complete`);
  if (totalImages    > 0) log(`  📸 Images extracted: ${totalImages}`);
  if (totalArtifacts > 0) log(`  🎭 Artifacts extracted: ${totalArtifacts}`);
  if (totalCitations > 0) log(`  🔗 Citations extracted: ${totalCitations}`);
  return capsule;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTitle() {
  let title = (document.title || '')
    .replace(/\s*[|·\-–—]\s*(ChatGPT|Claude|Gemini|DeepSeek|Grok|Copilot|Perplexity|Poe|Mistral|Kimi|Qwen|OpenRouter|New chat|New conversation).*$/i, '')
    .trim();

  if (!title || title.length < 3) {
    title = document.querySelector('h1')?.textContent?.trim() || '';
  }

  if (!title || title.length < 3) {
    title = document.querySelector(
      '[class*="conversation-title"], [class*="chat-title"], [aria-selected="true"]'
    )?.textContent?.trim() || '';
  }

  return title.length >= 2 ? title.substring(0, 120) : 'Untitled Chat';
}

function progress(onProgress, state) {
  if (typeof onProgress === 'function') {
    try { onProgress(state); } catch { /* non-critical */ }
  }
}

// ─── Async Image Screenshot & Capture Helpers ───────────────────────────────

/**
 * Selectors that identify any lightbox / modal / dialog overlay.
 * Centralised here so every part of the engine uses the exact same set.
 */
const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[class*="lightbox"]',
  '[class*="Lightbox"]',
  '[class*="Dialog"]',
  '[class*="dialog"]',
  '.fixed.inset-0.z-50',
  '[data-testid*="modal"]',
  '[class*="modal-content"]',
  '[class*="ModalContent"]',
  '[class*="image-viewer"]',
  '[class*="ImageViewer"]',
  '[class*="preview-modal"]',
  'g-image-viewer',
  'image-viewer',
  'g-lightbox',
  'g-dialog',
  'g-modal',
  '[class*="image-preview"]',
  '[class*="ImagePreview"]',
  '[class*="fullscreen"]',
  '[class*="full-screen"]',
  '[class*="expanded-image"]',
  '[class*="image-lightbox"]',
  '[class*="image-overlay"]'
];

/** Returns the first currently-open modal/lightbox, or null */
function getActiveModal() {
  for (const sel of MODAL_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && (el.offsetHeight > 0 || el.offsetWidth > 0)) return el;
    } catch {}
  }
  return null;
}

/**
 * Global screenshot mutex — prevents two screenshot operations from running
 * in parallel, which caused the "taking SS again and again like a loop" bug.
 * Only one screenshot sequence runs at a time; others queue behind it.
 */
let _snpSsLock = Promise.resolve();

function withScreenshotLock(fn) {
  // Chain onto the existing lock so calls are serialised
  _snpSsLock = _snpSsLock.then(() => fn()).catch(() => null);
  return _snpSsLock;
}

/**
 * Deep Shadow DOM piercing recursive tree traversal.
 * Recursively collects every element in a node structure including within active Shadow Roots.
 */
function getAllElementsPiercing(root) {
  const elements = [];
  function traverse(node) {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      elements.push(node);
      if (node.shadowRoot) {
        traverse(node.shadowRoot);
      }
    }
    let child = node.firstChild;
    while (child) {
      traverse(child);
      child = child.nextSibling;
    }
  }
  traverse(root);
  return elements;
}

/**
 * Helper to dispatch a complete sequence of pointer, mouse, focus and click events
 * to completely bypass React synthetic events and custom mousedown/mouseup listeners.
 */
function dispatchClickEvents(el) {
  if (!el) return;
  try {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    if (typeof el.click === 'function') {
      el.click();
    }
  } catch (err) {}
}

async function cropViewportScreenshot(rect, dataUrl) {
  return new Promise((resolve) => {
    try {
      if (!rect || !dataUrl) return resolve(null);

      const img = new Image();
      img.onload = () => {
        try {
          const dpr = window.devicePixelRatio || 1;

          // Scale rect to physical pixels of the captured viewport screenshot
          const x = Math.max(0, rect.left * dpr);
          const y = Math.max(0, rect.top * dpr);
          const w = Math.min(img.width - x, rect.width * dpr);
          const h = Math.min(img.height - y, rect.height * dpr);

          if (w <= 0 || h <= 0) {
            return resolve(dataUrl); // Fallback to full screenshot if rect is invalid
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return resolve(dataUrl);
          }

          ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          console.error('[Synapse Crop] Crop failed:', e);
          resolve(dataUrl); // fallback to original
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (err) {
      console.error('[Synapse Crop] cropViewportScreenshot error:', err);
      resolve(dataUrl);
    }
  });
}

/**
 * Viewport screenshot fallback logic.
 *
 * MUTEX: Wrapped via withScreenshotLock() at call site so only ONE screenshot
 * sequence runs at a time — fixes the "screenshot loop" where a failed modal
 * close caused the engine to keep capturing the same lightbox repeatedly.
 *
 * Flow:
 *   1. Close any pre-existing modal (cleanup from a previous failed close)
 *   2. Click the element (escalate to parents if needed) until a modal opens
 *   3. Take viewport screenshot
 *   4. Close the modal and VERIFY it is actually gone (up to 2s retry)
 *   5. Crop the screenshot to the image bounding box
 */
async function captureViaScreenshotFallbackInner(element, log) {
  if (!element) return null;
  log(`  [Screenshot Fallback] Starting sequence for element:`, element);

  // 0. If a modal is already open from a previous (failed) sequence, close it first
  const preExisting = getActiveModal();
  if (preExisting) {
    log(`  [Screenshot Fallback] ⚠️ Pre-existing modal detected — closing before starting.`);
    await forceCloseModal(preExisting, log);
    await waitForModalGone(log, 1500);
  }

  // 1. Click target modal-opening loop
  let modalOpened = false;
  let currentEl = element;
  
  for (let depth = 0; depth < 5; depth++) {
    if (!currentEl || currentEl === document.body || currentEl.tagName === 'ARTICLE') break;

    log(`  [Screenshot Fallback] Attempting click escalation at depth ${depth}...`);
    dispatchClickEvents(currentEl);

    // Wait for modal open animation
    await new Promise(r => setTimeout(r, 280));

    if (getActiveModal()) {
      log(`  [Screenshot Fallback] ✅ Modal detected open!`);
      modalOpened = true;
      break;
    }

    currentEl = currentEl.parentElement;
  }
  
  if (!modalOpened) {
    log(`  [Screenshot Fallback] ⚠️ No modal. Trying one more direct click...`);
    try { element.click(); } catch {}
    await new Promise(r => setTimeout(r, 350));
    if (getActiveModal()) {
      modalOpened = true;
      log(`  [Screenshot Fallback] ✅ Modal opened on final click.`);
    }
  }

  // 2. Extra settle time for modal open animation
  await new Promise(r => setTimeout(r, 350));

  // Determine crop target
  let cropTarget = element;
  if (modalOpened) {
    const lightboxEl = getActiveModal();
    if (lightboxEl) {
      const largeImg = lightboxEl.querySelector('img');
      cropTarget = (largeImg && largeImg.clientWidth > 50) ? largeImg : lightboxEl;
    }
  } else {
    log(`  [Screenshot Fallback] Scrolling element to center for direct capture...`);
    try { element.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch {}
    await new Promise(r => setTimeout(r, 150));
    cropTarget = element;
  }

  const rect = cropTarget.getBoundingClientRect();

  // 3. Request viewport screenshot from background script
  log(`  [Screenshot Fallback] Dispatching SYNAPSE_CAPTURE_SCREENSHOT to service worker...`);
  let dataUrl = null;
  try {
    dataUrl = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log(`  [Screenshot Fallback] SYNAPSE_CAPTURE_SCREENSHOT timed out`);
        resolve(null);
      }, 8000);

      chrome.runtime.sendMessage({ action: 'SYNAPSE_CAPTURE_SCREENSHOT' }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          log(`  [Screenshot Fallback] Runtime message error:`, chrome.runtime.lastError.message);
          resolve(null);
        } else if (response?.success && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          log(`  [Screenshot Fallback] Screenshot action returned no data`);
          resolve(null);
        }
      });
    });
  } catch (e) {
    log(`  [Screenshot Fallback] Messaging threw error:`, e.message);
  }

  // 4. Close the modal and VERIFY it is actually gone
  const finalModal = getActiveModal();
  if (modalOpened || finalModal) {
    log(`  [Screenshot Fallback] Closing modal...`);
    await forceCloseModal(finalModal || getActiveModal(), log);
    // Wait until modal is confirmed gone (up to 2s) before processing next image
    const closed = await waitForModalGone(log, 2000);
    if (!closed) {
      log(`  [Screenshot Fallback] ⚠️ Modal may still be open — forcing body click as last resort.`);
      try { document.body.click(); } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
  }

  if (dataUrl) {
    log(`  [Screenshot Fallback] Viewport capture successful! Length: ${dataUrl.length}. Cropping to target bounding box...`);
    dataUrl = await cropViewportScreenshot(rect, dataUrl);
    if (dataUrl) {
      log(`  [Screenshot Fallback] ✅ Crop successful! Cropped length: ${dataUrl.length}`);
    } else {
      log(`  [Screenshot Fallback] ❌ Crop failed or returned null`);
    }
  } else {
    log(`  [Screenshot Fallback] ❌ Viewport capture failed`);
  }

  return dataUrl;
}

/**
 * Public entry point for screenshot fallback — serialised through the global
 * mutex so concurrent calls (multiple images in one turn) run sequentially.
 */
function captureViaScreenshotFallback(element, log) {
  return withScreenshotLock(() => captureViaScreenshotFallbackInner(element, log));
}

/**
 * Attempt every known close strategy against an active modal.
 * Does NOT verify that it actually closed — call waitForModalGone() after.
 */
async function forceCloseModal(modalEl, log) {
  try {
    // A. Escape key to all likely targets
    const escTargets = [document.activeElement, document, window, modalEl].filter(Boolean);
    escTargets.forEach(t => {
      try {
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        t.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      } catch {}
    });

    // B. Click close button inside the modal (piercing Shadow DOM)
    if (modalEl) {
      const descendants = getAllElementsPiercing(modalEl);
      for (const el of descendants) {
        try {
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const cls       = typeof el.className === 'string' ? el.className.toLowerCase() : '';
          const testId    = (el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '').toLowerCase();
          const idAttr    = (el.id || '').toLowerCase();
          
          const matchesCloseOrBack = 
            ariaLabel.includes('close') || ariaLabel.includes('back') || ariaLabel.includes('exit') || ariaLabel.includes('return') ||
            cls.includes('close') || cls.includes('back') || cls.includes('exit') || cls.includes('return') ||
            testId.includes('close') || testId.includes('back') || testId.includes('exit') ||
            idAttr.includes('close') || idAttr.includes('back') || idAttr.includes('exit');

          if (matchesCloseOrBack && (el.offsetHeight > 0 || el.clientWidth > 0)) {
            log(`  [Close] Clicking internal close/back el:`, el.tagName, cls.substring(0, 40));
            dispatchClickEvents(el);
            return; // found it
          }
        } catch {}
      }
    }

    // C. Document-level close button selectors
    const closeSelectors = [
      'button[aria-label="Close"]', 'button[aria-label="Close dialog"]',
      'button[aria-label*="close"]', 'button[aria-label*="Close"]',
      'button[aria-label="Back"]', 'button[aria-label="Go back"]',
      'button[aria-label*="back"]', 'button[aria-label*="Back"]',
      '[data-testid="modal-close"]', '#modal-close-button',
      '.lightbox-close', 'button.absolute.top-4.right-4',
      'button[class*="back"]', 'button[class*="close"]',
      '[class*="back-button"]', '[class*="close-button"]'
    ];
    for (const sel of closeSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetHeight > 0) {
          log(`  [Close] Clicking document-level:`, sel);
          dispatchClickEvents(btn);
          return;
        }
      } catch {}
    }

    // D. Last resort — click the backdrop
    log(`  [Close] Trying backdrop click...`);
    if (modalEl) {
      dispatchClickEvents(modalEl);
    }
    await new Promise(r => setTimeout(r, 120));
    const backdrops = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="mask"]');
    for (const bd of backdrops) {
      if (bd.offsetHeight > 0) dispatchClickEvents(bd);
    }
  } catch (e) {
    log(`  [Close] Error during close:`, e.message);
  }
}

/**
 * Poll until no modal is detected, or timeoutMs elapses.
 * Returns true if modal gone, false if still present after timeout.
 */
async function waitForModalGone(log, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 120));
    if (!getActiveModal()) {
      log(`  [Screenshot Fallback] ✅ Modal confirmed closed.`);
      return true;
    }
  }
  log(`  [Screenshot Fallback] ⏱ Modal still present after ${timeoutMs}ms.`);
  return false;
}

async function elementToDataURL(imgEl) {
  return new Promise((resolve) => {
    try {
      if (!imgEl) return resolve(null);

      const drawAndResolve = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = imgEl.naturalWidth  || imgEl.width  || 300;
          canvas.height = imgEl.naturalHeight || imgEl.height || 300;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(imgEl, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(null);
        }
      };

      if (imgEl.complete && imgEl.naturalWidth !== 0) {
        drawAndResolve();
      } else {
        imgEl.addEventListener('load',  drawAndResolve,       { once: true });
        imgEl.addEventListener('error', () => resolve(null),  { once: true });
        setTimeout(() => resolve(null), 3000);
      }
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * Convert an image URL to a base64 data URL.
 *
 * Three-tier pipeline:
 *   1. Data URIs — already base64, return immediately.
 *   2. Same-origin or blob URLs — fetch directly from the content script.
 *   3. Canvas screenshot — works for same-origin images with no CORS issues.
 *   4. Cross-origin — use the background service worker as a CORS proxy.
 *
 * Fix from v2:
 *   Old same-origin check: url.includes(window.location.hostname)
 *   Problem: CDN URLs like "files.oaiusercontent.com" do NOT include
 *   "chatgpt.com" — they were attempted as same-origin, hitting CORS,
 *   and then falling through to the background proxy with 1–3s wasted.
 *
 *   New check: compare URL origins via the URL constructor.
 *   blob: and data: URLs are always treated as accessible.
 */
async function getBase64FromImageUrl(url, imgEl) {
  try {
    // 1. Data URIs — already base64
    if (url.startsWith('data:')) return url;

    // 2. Blob URLs — try fetch first, fallback to canvas screenshot on failure (bypasses CSP network restrictions!)
    if (url.startsWith('blob:')) {
      try {
        const res  = await fetch(url);
        const blob = await res.blob();
        const dataUrl = await blobToDataURL(blob);
        if (dataUrl) return dataUrl;
      } catch (e) {
        console.warn('[Synapse] Blob fetch failed, falling back to canvas screenshot:', e.message);
      }
    }

    // 3. True same-origin check — compare origins, not hostname substrings
    let isSameOrigin = false;
    try {
      const parsed = new URL(url);
      isSameOrigin = parsed.origin === window.location.origin;
    } catch { /* malformed URL — not same-origin */ }

    if (isSameOrigin) {
      try {
        const res  = await fetch(url);
        const blob = await res.blob();
        return await blobToDataURL(blob);
      } catch (e) {
        console.warn('[Synapse] Same-origin fetch failed, trying canvas:', e.message);
      }
    }

    // 4. Canvas screenshot (works for cross-origin images already painted in the DOM)
    try {
      const canvasData = await elementToDataURL(imgEl);
      if (canvasData && canvasData.length > 200) {
        // Reject blank 1×1 or minimal canvases
        const BLANK_PNG_PREFIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA';
        if (!canvasData.startsWith(BLANK_PNG_PREFIX)) {
          return canvasData;
        }
      }
    } catch (e) {
      // Canvas tainted by cross-origin — expected, fall through
    }

    // 5. Cross-origin — use the background service worker as a CORS proxy
    console.log('[Synapse] Using background proxy for cross-origin image:', url.substring(0, 80));
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn('[Synapse] Background image fetch timed out for:', url.substring(0, 60));
        resolve(null);
      }, 10000);

      chrome.runtime.sendMessage({ action: 'SYNAPSE_FETCH_IMAGE', url }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.warn('[Synapse] Background fetch error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        if (response?.success && response.dataUrl) {
          resolve(response.dataUrl);
        } else {
          console.warn('[Synapse] Background fetch returned no data for:', url.substring(0, 60));
          resolve(null);
        }
      });
    });
  } catch (err) {
    console.error('[Synapse] getBase64FromImageUrl failed:', url.substring(0, 60), err);
    return null;
  }
}

/** Convert a Blob to a data URL via FileReader */
async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractImagesFromNode(node, log, messageId, role, platform) {
  if (!node) return [];
  
  // Skip image/attachment capture for Gemini alone per setting
  if (platform === 'gemini') {
    log('  [Capture Engine] 🚫 Skipping image/attachment extraction for Gemini alone.');
    return [];
  }

  const images = [];

  // Enclosing conversation turn/container.
  // Now also matches Claude and Gemini Turn Containers.
  let turnContainer = node.closest(
    'article, [role="article"], fieldset, ' +
    '[data-testid^="conversation-turn"], [class*="conversation-turn"], ' +
    '[data-testid="human-turn"], [data-testid="ai-turn"], ' +
    '.group\\/conversation-turn, [class*="MessageRow"], ' +
    '[class*="query-container"], [class*="response-container"], ' +
    '[class*="user-query-container"], [class*="model-response-container"], ' +
    'message-content, [class*="message-content"], [class*="message-wrapper"], ' +
    '[class*="chat-item"], [class*="talk-row"], .user-query-container'
  ) || node;

  // Fallback for custom elements siblings (like Gemini's <user-query> which has images in its parent container)
  if (turnContainer === node && node.parentElement) {
    turnContainer = node.parentElement;
  }

  const discoveredUrls = new Set();
  const candidates = []; // Array of { url, element }

  const addCandidate = (url, el) => {
    if (!url || typeof url !== 'string') return;
    let resolvedUrl = url;
    try { resolvedUrl = new URL(url, window.location.href).href; } catch {}
    if (discoveredUrls.has(resolvedUrl)) return;
    discoveredUrls.add(resolvedUrl);
    candidates.push({ url: resolvedUrl, element: el });
  };

  // Traverse the turnContainer to find all possible image/attachment sources, piercing Shadow DOM recursively
  const allElements = getAllElementsPiercing(turnContainer);
  allElements.forEach(el => {
    // 1. <img> tags
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src') || el.src;
      if (src) addCandidate(src, el);
    }

    // 2. <a> tags with image/file links or known CDN domains
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || el.href;
      if (href && (
        href.includes('oaiusercontent.com') ||
        href.includes('googleusercontent.com') ||
        href.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i)
      )) {
        addCandidate(href, el);
      }
    }

    // 3. background-image in inline styles
    const style = el.getAttribute('style') || '';
    if (style.includes('background-image')) {
      const match = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
      if (match?.[1]) addCandidate(match[1], el);
    }

    // 4. Custom data attributes (data-src, data-url, etc.)
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && (
        attr.value.includes('oaiusercontent.com') ||
        attr.value.includes('googleusercontent.com') ||
        attr.value.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i)
      )) {
        addCandidate(attr.value, el);
      }
    }
  });

  log(`  Scanning ${candidates.length} potential image candidates in this message turn...`);

  const processedEls = new Set();

  for (const { url, element } of candidates) {
    const src = url;
    processedEls.add(element);

    const w = element.naturalWidth  || element.width  || element.clientWidth  || 999;
    const h = element.naturalHeight || element.height || element.clientHeight || 999;

    // ── Negative filters for known avatars/icons ──────────────────────────
    const isTiny      = (w > 0 && w <= 32 && h > 0 && h <= 32);
    const isSvgDataUri = src.startsWith('data:image/svg+xml');

    const hasAvatarClass = element.classList.contains('avatar')  ||
                           element.classList.contains('icon')    ||
                           (element.parentElement && (
                             element.parentElement.classList.contains('avatar') ||
                             element.parentElement.className?.toString().includes('avatar') ||
                             element.parentElement.className?.toString().includes('profile-pic')
                           ));

    const urlPath = (() => { try { return new URL(src, window.location.href).pathname; } catch { return src; } })();
    const isAvatarPath = /\/(avatar|profile[-_]?(pic|img|image)|favicon|icon)\b/i.test(urlPath);

    // ── Positive override: confirmed attachment sources ───────────────────
    // These bypass all avatar/tiny checks since they are known content sources.
    const isConfirmedAttachment =
      src.startsWith('blob:') ||
      src.includes('oaiusercontent.com') ||
      src.includes('googleusercontent.com') ||
      !!(element.closest?.(
        '[class*="attachment"], [class*="file"], [class*="preview"], [class*="media"], ' +
        '[data-testid*="attachment"], [data-testid*="image"], [data-testid*="dalle"],' +
        '[data-testid="dalle-image"], [class*="dalle"], [class*="dall-e"], ' +
        '[class*="generated-image"], [class*="image-result"]'
      ));

    let shouldSkip = false;
    if (!isConfirmedAttachment) {
      shouldSkip = isTiny || isSvgDataUri || hasAvatarClass || isAvatarPath;
    } else {
      // Confirmed attachments are never skipped unless they are SVG data URIs (UI icons)
      shouldSkip = isSvgDataUri;
    }

    if (shouldSkip) {
      log(`  Skipping UI icon/avatar candidate: ${src.substring(0, 60)}`);
      continue;
    }

    const attachmentWrapper = element.closest(
      '[class*="attachment"], [class*="file"], [class*="preview"], [class*="media"], ' +
      '[class*="thumbnail"], [class*="upload"], [class*="dalle"], [class*="dall-e"], ' +
      '[class*="aspect-"], [data-testid*="attachment"], [data-testid*="image"], ' +
      '[data-testid*="file"], [data-testid="dalle-image"], [class*="generated-image"]'
    );

    const altText = element.getAttribute('alt') || element.getAttribute('title') || '';
    const score = isConfirmedAttachment ? 10 : 5;

    log(`  Extracting image: ${src.substring(0, 80)}...`);
    
    // Tiered extraction: try standard URL proxy/canvas fetch first
    let dataUrl = await getBase64FromImageUrl(src, element);
    
    // FALLBACK: If standard extraction fails (which is highly expected on ChatGPT/Gemini/Claude encrypted blob/CDN urls),
    // trigger our high-fidelity viewport screenshot pipeline.
    if (!dataUrl) {
      log(`  ⚠️ Direct fetch/canvas failed for: ${src.substring(0, 60)}. Invoking high-fidelity screenshot fallback...`);
      dataUrl = await captureViaScreenshotFallback(element, log);
    }

    if (dataUrl) {
      const textExtraction = attachmentWrapper?.textContent?.trim() || altText || 'Captured Image';

      images.push({
        messageId,
        role,
        timestamp: Date.now(),
        platform,
        metadata: {
          width:       w === 999 ? 400 : w,
          height:      h === 999 ? 300 : h,
          alt:         altText || 'Captured Image',
          mimeType:    dataUrl.match(/data:([^;]+);/)?.[1] || 'image/png',
          originalSrc: src.substring(0, 200),
          score,
        },
        textExtraction: textExtraction.substring(0, 1000),
        thumbnail: dataUrl,
        preview:   dataUrl,
      });
      log(`  ✅ Captured image ${images.length} (${dataUrl.length} chars base64, Score: ${score})`);
    } else {
      log(`  ❌ Failed to capture image: ${src.substring(0, 80)}`);
    }
  }

  // ── Non-Image Document / File Attachments Discovery ─────────────────────
  // Scan for cards or pills that represent uploaded documents, slides, files, or datasets.
  const attachmentSelectors = [
    '[class*="attachment"]',
    '[class*="file-card"]',
    '[class*="file_card"]',
    '[class*="fileCard"]',
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[class*="media-"]',
    '[class*="media_"]',
    '[class*="mediaCard"]',
    'a[href*="/files/"]',
    'a[href*="/file/"]',
  ];

  const docCandidates = [];

  attachmentSelectors.forEach(selector => {
    try {
      turnContainer.querySelectorAll(selector).forEach(el => {
        // Skip if this element or any of its children were already processed as image candidates
        if (processedEls.has(el)) return;
        let alreadyHasImage = false;
        el.querySelectorAll('*').forEach(child => {
          if (processedEls.has(child)) alreadyHasImage = true;
        });
        if (alreadyHasImage) return;

        // Skip tiny elements (e.g. utility icons or text snippets)
        if (el.clientWidth < 40 || el.clientHeight < 20) return;

        // Exclude structural nodes (prevent zipping whole message turn as document)
        const tagName = el.tagName;
        if (tagName === 'ARTICLE' || tagName === 'FIELDSET' || tagName === 'FORM' || tagName === 'MAIN' || el === turnContainer) return;

        // Ensure unique top-level document containers to avoid duplicate captures
        let isChildOfOther = false;
        for (const other of docCandidates) {
          if (other.contains(el)) {
            isChildOfOther = true;
            break;
          }
        }
        if (!isChildOfOther) {
          docCandidates.push(el);
          processedEls.add(el); // Prevent matching in sub-elements
        }
      });
    } catch {}
  });

  if (docCandidates.length > 0) {
    log(`  Scanning ${docCandidates.length} potential non-image document/file attachments...`);
  }

  for (const docEl of docCandidates) {
    log(`  Extracting document/file preview via screenshot fallback...`);
    const docDataUrl = await captureViaScreenshotFallback(docEl, log);
    if (docDataUrl) {
      const textExtraction = docEl.textContent?.trim() || 'Uploaded Document';
      images.push({
        messageId,
        role,
        timestamp: Date.now(),
        platform,
        metadata: {
          width:       800,
          height:      600,
          alt:         textExtraction.substring(0, 100) || 'Uploaded Document',
          mimeType:    'image/png',
          originalSrc: 'screenshot-fallback',
          score:       8,
        },
        textExtraction: textExtraction.substring(0, 1000),
        thumbnail: docDataUrl,
        preview:   docDataUrl,
      });
      log(`  ✅ Captured document screenshot (${docDataUrl.length} chars base64)`);
    } else {
      log(`  ❌ Failed to capture document screenshot fallback`);
    }
  }

  if (images.length > 0) {
    log(`  📸 Total images/documents captured from this turn: ${images.length}`);
  }
  return images;
}
