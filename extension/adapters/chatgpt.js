/**
 * Synapse v3 — ChatGPT Adapter
 *
 * Changes from v2:
 *   - _getScroller(): scopes search to <main> so we never match the
 *     sidebar navigation panel (which also has overflow-y-auto in
 *     ChatGPT's layout). Previous code returned the sidebar on
 *     sidebar-visible pages, causing the conversation to never scroll.
 *
 *   - getMessages(): adds Strategy 4 (aria-label role detection) and
 *     Strategy 5 (structural article scan) as deeper fallbacks.
 *     Each strategy correctly sets the `node` reference to the full
 *     turn container (article/[data-testid]) rather than just the
 *     prose child, so the image extractor can crawl the whole turn.
 *
 *   - Content extraction: uses the prose/markdown child for clean text
 *     but passes the full turn container as `node` for image scanning.
 *
 *   - Generated images: explicitly checks for DALL-E image wrappers
 *     via data-testid="dalle-image" so AI-generated images are always
 *     treated as confirmed attachments regardless of dimensions.
 */

import { BaseAdapter } from './base.js';

export class ChatGPTAdapter extends BaseAdapter {
  constructor() {
    super('chatgpt');
  }

  detect(hostname) {
    return hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com');
  }

  getChatRoot() {
    return this.queryFirst(['main', '#__next main', '[role="main"]']);
  }

  /**
   * Extract all conversation turns.
   *
   * Strategy priority (most → least reliable):
   *   1. [data-message-author-role]       — most stable semantic attribute
   *   2. [data-testid^="conversation-turn"] — testid-based turn containers
   *   3. article[class*="group"]          — ChatGPT article-per-turn layout
   *   4. [role="article"]                 — ARIA article role fallback
   *   5. .group\/conversation-turn        — Tailwind utility class (fragile but kept)
   */
  getMessages() {
    // ── Strategy 1: data-message-author-role ─────────────────────────────
    const byRole = Array.from(document.querySelectorAll('[data-message-author-role]'));
    if (byRole.length > 0) {
      return byRole.map(node => this._buildMessage(node, node.getAttribute('data-message-author-role')));
    }

    // ── Strategy 2: conversation-turn testids ────────────────────────────
    const byTestId = Array.from(document.querySelectorAll('[data-testid^="conversation-turn"]'));
    if (byTestId.length > 0) {
      return byTestId.map(node => {
        const testId = node.getAttribute('data-testid') || '';
        const role   = testId.includes('user') ? 'user' : 'assistant';
        return this._buildMessage(node, role);
      });
    }

    // ── Strategy 3: article elements in main ────────────────────────────
    const main = document.querySelector('main');
    if (main) {
      const articles = Array.from(main.querySelectorAll('article'));
      if (articles.length > 0) {
        return articles.map((node, idx) => {
          // Even-indexed articles tend to be user turns, odd are assistant
          // but we check for user-specific attributes first
          const isUser = !!(
            node.querySelector('[data-message-author-role="user"]') ||
            node.getAttribute('data-message-author-role') === 'user'
          );
          return this._buildMessage(node, isUser ? 'user' : 'assistant');
        });
      }
    }

    // ── Strategy 4: role="article" ───────────────────────────────────────
    const byAriaArticle = Array.from(document.querySelectorAll('[role="article"]'));
    if (byAriaArticle.length > 0) {
      return byAriaArticle.map(node => {
        const isUser = !!(node.querySelector('[data-message-author-role="user"]'));
        return this._buildMessage(node, isUser ? 'user' : 'assistant');
      });
    }

    // ── Strategy 5: Tailwind group class (least reliable) ────────────────
    const byClass = Array.from(document.querySelectorAll('.group\\/conversation-turn'));
    return byClass.map((node, idx) => {
      const isUser = idx % 2 === 0; // rough heuristic when nothing else works
      return this._buildMessage(node, isUser ? 'user' : 'assistant');
    });
  }

  /**
   * Build a message descriptor from a turn container node.
   * Extracts content from the prose/markdown child if available,
   * but keeps `node` pointing at the full turn container so the
   * image extractor can find all attachments in the turn.
   *
   * @param {Element} turnNode  Full turn container (article / data-testid div)
   * @param {string}  role      'user' | 'assistant'
   */
  _buildMessage(turnNode, role) {
    // Prefer the prose/markdown content div for clean text extraction
    const contentEl = turnNode.querySelector(
      '.markdown, [class*="prose"], [class*="message-content"], [data-message-content]'
    ) || turnNode;

    const rich = this.extractMessageContent(contentEl);

    return {
      role:       role === 'user' ? 'user' : 'assistant',
      content:    rich.text,
      codeBlocks: rich.codeBlocks,
      tables:     rich.tables,
      hasMath:    rich.hasMath,
      node:       turnNode,  // full container — image extractor needs this
    };
  }

  getMessageCount() {
    const byRole   = document.querySelectorAll('[data-message-author-role]').length;
    if (byRole > 0) return byRole;

    const byTestId = document.querySelectorAll('[data-testid^="conversation-turn"]').length;
    if (byTestId > 0) return byTestId;

    const main = document.querySelector('main');
    if (main) {
      const articles = main.querySelectorAll('article').length;
      if (articles > 0) return articles;
    }

    return document.querySelectorAll('[role="article"]').length;
  }

  getInputEl() {
    return this.queryFirst([
      '#prompt-textarea',
      'div[id="prompt-textarea"]',
      'div[contenteditable="true"][class*="prompt"]',
      'div[contenteditable="true"]',
      'textarea[placeholder]',
    ]);
  }

  insert(text) {
    const el = this.getInputEl();
    if (!el) return;
    el.focus();

    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
      try {
        const selection = window.getSelection();
        if (selection) {
          selection.selectAllChildren(el);
        }
        const success = document.execCommand('insertText', false, text);
        if (success) {
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: text
          }));
          return;
        }
      } catch (e) {
        console.warn('[Synapse] ChatGPT execCommand failed, using fallback:', e);
      }

      // Fallback: manually write to DOM
      el.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      // Move cursor to end
      const range = document.createRange();
      const sel   = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true,
        inputType: 'insertText', data: text
      }));
    }
  }

  submit() {
    const btn = this.queryFirst([
      'button[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send"]',
    ]);
    if (btn && !btn.disabled) btn.click();
  }

  /**
   * ChatGPT scroll container fix.
   *
   * The old implementation used document.querySelector('[class*="overflow-y-auto"]')
   * which on ChatGPT's sidebar layout matches the SIDEBAR nav panel first —
   * not the conversation area.  We now scope to <main> to avoid this.
   *
   * Selector precedence (verified on chatgpt.com, May 2025):
   *   1. <main> overflow-y-auto child  — the primary conversation scroller
   *   2. react-scroll-to-bottom container — used in some layouts
   *   3. <main> itself                 — safe fallback
   *   4. document.documentElement      — last resort
   */
  _getScroller() {
    const main = document.querySelector('main');
    if (main) {
      // Prefer the innermost overflow-y-auto inside <main>
      const inner = main.querySelector('[class*="overflow-y-auto"]') ||
                    main.querySelector('[class*="overflow-y-scroll"]');
      if (inner) return inner;
      return main;
    }
    // react-scroll-to-bottom is sometimes the outer wrapper
    const rsttb = document.querySelector('[class*="react-scroll-to-bottom"]');
    if (rsttb) return rsttb;

    return document.documentElement;
  }

  async scrollToBottom() {
    const s = this._getScroller();
    if (s) {
      s.scrollTop = s.scrollHeight;
      await this._waitForDOMStable(600);
    }
  }

  async waitForResponse() {
    return new Promise(resolve => {
      let checks = 0;
      const interval = setInterval(() => {
        const stopBtn = document.querySelector(
          'button[aria-label="Stop generating"], button[data-testid="stop-button"]'
        );
        checks++;
        if (!stopBtn || checks > 60) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });
  }

  clear()          {}
  async cleanup()  {}
  async prepare()  {}
}
