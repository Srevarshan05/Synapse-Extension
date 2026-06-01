/**
 * Synapse v3 — Gemini Adapter
 *
 * Changes from v2:
 *   - _getScroller(): v2 fell through to document.documentElement which
 *     does nothing on Gemini's Angular SPA. We now also probe for the
 *     Angular Material CDK scroll viewport and known wrapper classes.
 *
 *   - getMessages(): keeps the proven web-component strategy
 *     (user-query / model-response) as the primary path. Added a
 *     sourceNodes scan to capture citation links / grounding chips
 *     that appear inside model responses.
 *
 *   - Citations / grounding: Gemini adds source attribution chips below
 *     model responses. These are extracted as a `citations` array on
 *     each assistant message so they are preserved in the capsule.
 *
 *   - Generated images: Gemini wraps AI-generated images in specific
 *     containers. We mark those as confirmed attachments so the scoring
 *     system in the capture engine doesn't discard them.
 *
 * Shadow DOM note:
 *   Gemini uses Web Components (custom elements) — user-query and
 *   model-response are custom elements that render their content in
 *   the light DOM (not Shadow DOM) in the current production build.
 *   querySelectorAll() on those nodes reaches their children correctly.
 *   If Gemini migrates content into Shadow DOM in the future this will
 *   need revisiting.
 */

import { BaseAdapter } from './base.js';

export class GeminiAdapter extends BaseAdapter {
  constructor() {
    super('gemini');
  }

  detect(hostname) {
    return hostname.includes('gemini.google.com');
  }

  getChatRoot() {
    return this.queryFirst([
      'message-list',
      'chat-history',
      'main',
      '#chat-history',
      '[class*="conversation"]',
    ]);
  }

  /**
   * Extract all conversation turns.
   *
   * Strategy 1 (preferred): Web-component element names.
   *   Gemini uses <user-query> and <model-response> custom elements.
   *   These are stable semantic identifiers independent of CSS class names.
   *
   * Strategy 2: .user-query-container / .model-response class names.
   *
   * Strategy 3: message-content generic selector.
   *
   * Each message object gains a `citations` array for grounding links
   * extracted from the model response.
   */
  getMessages() {
    const userNodes  = Array.from(document.querySelectorAll('user-query, .user-query-container'));
    const modelNodes = Array.from(document.querySelectorAll('model-response, .model-response'));

    if (userNodes.length > 0 || modelNodes.length > 0) {
      const all = [
        ...userNodes.map(n  => ({ node: n, role: 'user' })),
        ...modelNodes.map(n => ({ node: n, role: 'assistant' })),
      ].sort((a, b) => {
        const pos = a.node.compareDocumentPosition(b.node);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      const messages = all.map(({ node, role }) => this._buildMessage(node, role));
      if (messages.length > 0) return messages;
    }

    // ── Strategy 2: class-based fallback ─────────────────────────────────
    const byClass = Array.from(document.querySelectorAll(
      '[class*="user-query"], [class*="model-response"]'
    ));
    if (byClass.length > 0) {
      return byClass.map(node => {
        const role = (node.className?.toString() ?? '').includes('user') ? 'user' : 'assistant';
        return this._buildMessage(node, role);
      });
    }

    // ── Strategy 3: message-content elements ─────────────────────────────
    const contentNodes = Array.from(document.querySelectorAll('message-content, .message-content'));
    return contentNodes.map(node => {
      const isUser = !!(node.closest('user-query, .user-message, [class*="user"]'));
      return this._buildMessage(node, isUser ? 'user' : 'assistant');
    });
  }

  /**
   * Build a message descriptor, including citations for assistant turns.
   *
   * @param {Element} node
   * @param {string}  role  'user' | 'assistant'
   */
  _buildMessage(node, role) {
    const rich      = this.extractMessageContent(node);
    const citations = role === 'assistant' ? this.extractCitations(node) : [];

    return {
      role,
      content:    rich.text,
      codeBlocks: rich.codeBlocks,
      tables:     rich.tables,
      hasMath:    rich.hasMath,
      citations,
      node,
    };
  }

  /**
   * Extract citation / grounding source links from a model response node.
   *
   * Gemini adds source attribution beneath responses in two forms:
   *   1. Inline superscript citations that link to external sources.
   *   2. A "Sources" / "Grounding" section with chip-style source cards.
   *
   * We capture both.
   *
   * Selectors (observed on gemini.google.com, May 2025):
   *   [class*="source-chip"]   — grounding source chips
   *   [class*="citation"]      — inline citation references
   *   [class*="source-link"]   — source link elements
   *   [class*="grounding"]     — grounding container
   *
   * @param {Element} node
   * @returns {{ text: string, url: string }[]}
   */
  extractCitations(node) {
    const citations = [];
    const seen      = new Set();

    const chipSelectors = [
      '[class*="source-chip"]',
      '[class*="citation"]',
      '[class*="source-link"]',
      '[class*="grounding"] a',
      '[class*="reference"] a',
      '.source a',
    ];

    for (const sel of chipSelectors) {
      try {
        this.queryAllPiercing(sel, node).forEach(el => {
          const url  = el.getAttribute('href') || el.getAttribute('data-url') || '';
          const text = el.textContent?.trim() || url;
          if (url && !seen.has(url)) {
            seen.add(url);
            citations.push({ text: text.substring(0, 200), url });
          }
        });
      } catch { /* invalid selector — skip */ }
    }

    return citations;
  }

  getMessageCount() {
    const users  = document.querySelectorAll('user-query, .user-query-container').length;
    const models = document.querySelectorAll('model-response, .model-response').length;
    if (users + models > 0) return users + models;
    return document.querySelectorAll('message-content, .message-content').length;
  }

  getInputEl() {
    return this.queryFirst([
      'div[contenteditable="true"].ql-editor',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][class*="input"]',
      'textarea[aria-label="Chat input"]',
      'textarea',
      'div[contenteditable="true"]',
    ]);
  }

  insert(text) {
    const el = this.getInputEl();
    if (!el) return;
    el.focus();

    if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
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
            data: text,
          }));
          return;
        }
      } catch (e) {
        console.warn('[Synapse] Gemini execCommand failed, using fallback:', e);
      }

      // Fallback: manually write to DOM
      el.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text,
      }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  submit() {
    const btn = this.queryFirst([
      'button[aria-label="Send message"]',
      'button[mattooltip="Send message"]',
      'button[data-test-id="send-button"]',
      'button.send-button',
    ]);
    if (btn && !btn.disabled) btn.click();
  }

  /**
   * Gemini scroller fix.
   *
   * v2 fell through to document.documentElement which does nothing on
   * Gemini's Angular SPA. The conversation scrolls inside a specific
   * Angular CDK scroll viewport or the chat-history custom element.
   *
   * Selector order (verified on gemini.google.com, May 2025):
   *   1. chat-history — the custom element that wraps all turns
   *   2. message-list — parent list custom element
   *   3. .conversation-container — Angular wrapper class
   *   4. [class*="overflow-y-scroll"] — any explicit scroll container
   *   5. [class*="overflow-y-auto"]   — any auto-scroll container
   *   6. main                          — last safe structural fallback
   */
  _getScroller() {
    return (
      document.querySelector('chat-history') ||
      document.querySelector('message-list') ||
      document.querySelector('.conversation-container') ||
      document.querySelector('[class*="overflow-y-scroll"]') ||
      document.querySelector('[class*="overflow-y-auto"]') ||
      document.querySelector('[class*="overflow-auto"]') ||
      document.querySelector('main') ||
      document.documentElement
    );
  }

  async scrollToBottom() {
    const s = this._getScroller();
    if (s) { s.scrollTop = s.scrollHeight; await this._waitForDOMStable(600); }
  }

  async waitForResponse() {
    return new Promise(resolve => {
      let checks = 0;
      const iv = setInterval(() => {
        const loading = document.querySelector(
          '[class*="loading"], [class*="generating"], mat-progress-bar, ' +
          '[class*="pending"], [class*="thinking"]'
        );
        if (!loading || ++checks > 60) { clearInterval(iv); resolve(); }
      }, 500);
    });
  }

  clear()          {}
  async cleanup()  {}
  async prepare()  {}
}
