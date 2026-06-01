/**
 * Synapse v3 — Hydration Engine
 *
 * Goal: user NEVER sees the injected text.
 *
 * Flow:
 *   1. prepare()       — wait for input field to be ready
 *   2. inject()        — write text into DOM natively (React-compatible)
 *   3. submit()        — fire send in the SAME call (no delay)
 *   4. clear()         — wipe input in the SAME microtask as submit
 *   5. hideUserMsg()   — hide the injected user bubble from the conversation
 *   6. cleanup()       — optional adapter cleanup
 *
 * Key design decisions:
 *   - inject + submit + clear happen synchronously back-to-back.
 *     No await between them. This keeps the text invisible in the input.
 *   - After submit, we wait 800ms then hide the last user message bubble
 *     (which contains the raw context dump) so only the AI response shows.
 *   - No overlays, no heavy animations — just clean DOM hiding.
 */

import { buildContinuationPrompt } from './continuation-compiler.js';

// ─────────────────────────────────────────────────────────────────────────────
// HIDE INJECTED USER MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After the injected context is submitted, hide the last user message bubble
 * so users only see the AI response — not the raw context dump.
 *
 * Works across all three primary platforms:
 *   ChatGPT : [data-message-author-role="user"]
 *   Claude  : [data-testid="human-turn"]
 *   Gemini  : user-query
 *
 * Waits 800ms for the platform to render the sent message into the DOM,
 * then hides the last matching element.
 */
async function hideInjectedUserMessage() {
  // Wait for the platform to render the sent message bubble
  await new Promise(r => setTimeout(r, 800));

  const selectors = [
    '[data-message-author-role="user"]',  // ChatGPT
    '[data-testid="human-turn"]',          // Claude
    'user-query',                          // Gemini
    '.user-query-container',               // Gemini fallback
    '[class*="human-turn"]',               // Claude fallback
    '[data-is-human="true"]',              // Claude fallback
  ];

  for (const sel of selectors) {
    const els = Array.from(document.querySelectorAll(sel));
    if (els.length > 0) {
      const last = els[els.length - 1];
      if (last) {
        last.style.display = 'none';
        console.log(`[Synapse] Hidden injected user message (${sel})`);
        break;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HYDRATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('../adapters/base.js').BaseAdapter} adapter
 * @param {import('./types.js').SynapseCapsule} capsule
 * @param {'preview'|'silent'|'interactive'} mode
 * @returns {Promise<{ success: boolean, duration: number, chars: number, warnings: string[] }>}
 */
export async function hydrate(adapter, capsule, mode = 'silent') {
  const t0       = Date.now();
  const warnings = [];

  try {
    // ── 1. PREPARE: wait for the input to be stable ───────────────────────
    if (typeof adapter.prepare === 'function') await adapter.prepare();
    await adapter.scrollToBottom?.();

    // Poll for the input field (up to 5s) instead of a fixed sleep
    const inputEl = await waitForInput(adapter, 5000);
    if (!inputEl) {
      throw new Error(
        'Chat input not found. The page may still be loading — try again in a moment.'
      );
    }

    // ── 2. BUILD payload ──────────────────────────────────────────────────
    const prompt = capsule.continuationPrompt || buildContinuationPrompt(capsule);
    const chars  = prompt.length;
    console.log(`[Synapse] Hydrating — ${chars} chars, mode=${mode}`);

    // ── PREVIEW MODE: inject + leave (no submit, no hide) ─────────────────
    if (mode === 'preview') {
      injectNative(adapter, inputEl, prompt);
      return { success: true, duration: Date.now() - t0, chars, warnings };
    }

    // ── SILENT / INTERACTIVE MODE ─────────────────────────────────────────
    // Hide text visually during injection to avoid raw text flash
    const originalColor = inputEl.style.color;
    const originalCaret = inputEl.style.caretColor;
    inputEl.style.color = 'transparent';
    inputEl.style.caretColor = 'transparent';

    // Step A: inject
    injectNative(adapter, inputEl, prompt);

    // Step B: tiny yield so the platform's React reconciler processes input
    await nextFrame();

    // Step C: submit — immediately after React sees the input
    const submitted = fireSubmit(adapter, inputEl);
    if (!submitted) {
      warnings.push('Send button not found — press Enter to submit.');
    }

    // Step D: clear — happens with a safe 150ms delay to let asynchronous editor events complete.
    if (mode === 'silent') {
      setTimeout(() => {
        clearInput(inputEl);
      }, 150);
    }

    // Restore original visual styles after a safe delay
    setTimeout(() => {
      inputEl.style.color = originalColor;
      inputEl.style.caretColor = originalCaret;
    }, 800);

    // Step E: hide the injected user message bubble (async, non-blocking)
    hideInjectedUserMessage();

    // Step F: optional cleanup
    if (typeof adapter.cleanup === 'function') await adapter.cleanup();

    const duration = Date.now() - t0;
    console.log(`[Synapse] Hydration done in ${duration}ms`);
    return { success: true, duration, chars, warnings };

  } catch (err) {
    console.error('[Synapse] Hydration failed:', err);
    return { success: false, duration: Date.now() - t0, chars: 0, warnings: [err.message] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INJECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write text into an input element natively.
 * Works for: <textarea>, <input>, contentEditable divs (ChatGPT, Claude, Gemini).
 * Uses React's internal nativeInputValueSetter to bypass synthetic event blocking.
 */
function injectNative(adapter, el, text) {
  if (adapter && typeof adapter.insert === 'function') {
    try {
      adapter.insert(text);
      return;
    } catch (e) {
      console.warn('[Synapse] Adapter-specific insert failed, using fallback:', e);
    }
  }

  el.focus();

  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const proto  = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    setter ? setter.call(el, text) : (el.value = text);

    el.dispatchEvent(new Event('input',  { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  } else if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
    // Try document.execCommand first for rich text editors
    try {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const success = document.execCommand('insertText', false, text);
      if (success) {
        el.dispatchEvent(new InputEvent('input', {
          bubbles:   true,
          composed:  true,
          inputType: 'insertText',
          data:      text,
        }));
        return;
      }
    } catch (e) {
      console.warn('[Synapse] execCommand insertText failed, falling back to manual DOM write:', e);
    }

    // Fallback: structural block node mutation (extremely safe for ProseMirror/Lexical, works even when tab is unfocused)
    try {
      let p = el.querySelector('p, div');
      if (!p) {
        p = document.createElement('p');
        el.appendChild(p);
      }

      p.innerHTML = '';
      const textNode = document.createTextNode(text);
      p.appendChild(textNode);

      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));

      el.dispatchEvent(new InputEvent('input', {
        bubbles:   true,
        composed:  true,
        inputType: 'insertText',
        data:      text,
      }));

      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      console.error('[Synapse] Fallback structural insert failed:', e);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wipe the input element's content immediately after submit.
 */
function clearInput(el) {
  try {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto  = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, '') : (el.value = '');
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    } else if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
      el.innerHTML = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
  } catch { /* non-critical — message already sent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire the platform's send button or Enter key.
 */
function fireSubmit(adapter, inputEl) {
  if (typeof adapter.submit === 'function') {
    adapter.submit();
    return true;
  }

  const SEND_BTNS = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    '[class*="send"][role="button"]',
    '[data-testid="composer-submit-button"]',
  ];

  for (const sel of SEND_BTNS) {
    const btn = document.querySelector(sel);
    if (btn && !btn.disabled) { btn.click(); return true; }
  }

  if (inputEl) {
    inputEl.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, composed: true
    }));
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function waitForInput(adapter, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = typeof adapter.getInputEl === 'function' ? adapter.getInputEl() : null;
    if (el) return el;
    await nextFrame();
  }
  return null;
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(r));
}
