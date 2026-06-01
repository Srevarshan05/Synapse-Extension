/**
 * Synapse v3 — Claude Adapter
 *
 * Full rewrite.  Problems with the v2 implementation:
 *
 *   1. Primary selector was [data-test-render-count] — this attribute
 *      exists on internal React re-render bookkeeping nodes, not message
 *      containers.  It matched hundreds of elements, causing massive
 *      duplication and complete role mis-classification.
 *
 *   2. Role detection used closest('[class*="human"]') on those nodes,
 *      which returned null for most elements, labelling everything
 *      'assistant'.
 *
 *   3. Zero artifact extraction despite Claude artifacts being a core
 *      feature (standalone code, HTML, React previews in the side panel).
 *
 * This rewrite:
 *   - Uses stable semantic testid attributes as the primary strategy.
 *   - Falls back through progressively broader selectors.
 *   - Extracts artifacts as a first-class array on each message node.
 *   - Correctly scopes the scroller to the overflow pane inside <main>.
 *
 * Verified selectors (claude.ai, May 2025):
 *   Human turns:    [data-testid="human-turn"]
 *   AI turns:       [data-testid="ai-turn"]
 *   Message body:   .font-claude-message   (stable utility class for prose)
 *   Artifacts:      [data-testid^="artifact"]  or  [class*="artifact"]
 *
 * Note: Claude's artifact side panel renders in the same DOM tree but
 * inside a separate container.  We extract artifact content from the
 * turn that references it, not from the panel itself, since the panel
 * content is replicated inside the turn's artifact preview block.
 */

import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  constructor() {
    super('claude');
  }

  detect(hostname) {
    return hostname.includes('claude.ai');
  }

  getChatRoot() {
    // Claude's conversation thread is inside <main>
    return this.queryFirst([
      'main',
      '[class*="conversation-content"]',
      '[class*="chat-content"]',
      '.flex-1.overflow-hidden',
      '[class*="conversation"]',
    ]);
  }

  /**
   * Extract all conversation turns.
   *
   * Strategy priority:
   *   1. [data-testid="human-turn"] + [data-testid="ai-turn"]
   *      Stable semantic testids — Claude's most reliable selectors.
   *
   *   2. [data-is-human="true"] / [data-is-human="false"]
   *      Data attributes for explicit role marking.
   *
   *   3. .font-claude-message parent scanning
   *      Finds the message body class and walks up to the turn container.
   *
   *   4. Generic article / [role="article"] scan
   *      Structural fallback — same pattern as ChatGPT.
   *
   *   5. [class*="human-turn"] / [class*="ai-turn"]
   *      Class-name heuristic — least stable, last resort.
   */
  getMessages() {
    // ── Strategy 1: Testid-based (most reliable) ─────────────────────────
    const humanTurns = Array.from(document.querySelectorAll('[data-testid="human-turn"]'));
    const aiTurns    = Array.from(document.querySelectorAll('[data-testid="ai-turn"]'));

    if (humanTurns.length > 0 || aiTurns.length > 0) {
      return this._mergeAndBuild(
        humanTurns.map(n => ({ node: n, role: 'user' })),
        aiTurns.map(n => ({ node: n, role: 'assistant' }))
      );
    }

    // ── Strategy 2: data-is-human attribute ──────────────────────────────
    const byIsHuman = Array.from(document.querySelectorAll('[data-is-human]'));
    if (byIsHuman.length > 0) {
      return byIsHuman.map(node => {
        const isHuman = node.getAttribute('data-is-human') === 'true';
        return this._buildMessage(node, isHuman ? 'user' : 'assistant');
      });
    }

    // ── Strategy 3: .font-claude-message parent walk ──────────────────────
    const msgBodies = Array.from(document.querySelectorAll('.font-claude-message'));
    if (msgBodies.length > 0) {
      // Walk up to find the enclosing turn container
      const turns = msgBodies.map(body => {
        const turn = body.closest('[data-testid]') ||
                     body.closest('article, [role="article"]') ||
                     body.parentElement?.parentElement ||
                     body;
        // A .font-claude-message is always an AI response
        return { node: turn || body, role: 'assistant' };
      });
      return turns.map(({ node, role }) => this._buildMessage(node, role));
    }

    // ── Strategy 4: article elements ─────────────────────────────────────
    const articles = Array.from(document.querySelectorAll('article, [role="article"]'));
    if (articles.length > 0) {
      return articles.map(node => {
        const isUser = !!(
          node.closest('[class*="human"]') ||
          node.querySelector('[class*="user-message"]') ||
          node.getAttribute('data-is-human') === 'true'
        );
        return this._buildMessage(node, isUser ? 'user' : 'assistant');
      });
    }

    // ── Strategy 5: Class-name heuristics (least stable) ─────────────────
    const humanByClass = Array.from(
      document.querySelectorAll('[class*="human-turn"], [class*="HumanTurn"]')
    ).map(n => ({ node: n, role: 'user' }));

    const aiByClass = Array.from(
      document.querySelectorAll('[class*="ai-turn"], [class*="AiTurn"], [class*="assistant-turn"]')
    ).map(n => ({ node: n, role: 'assistant' }));

    if (humanByClass.length > 0 || aiByClass.length > 0) {
      return this._mergeAndBuild(humanByClass, aiByClass);
    }

    // ── Strategy 6: Outermost candidate traversal (Universal Heuristic Fallback) ──
    const genericSelectors = [
      '[data-testid*="message"]',
      '[data-testid*="turn"]',
      '[class*="font-claude"]',
      '[class*="font-claude-message"]',
      '[class*="message-content"]',
      '[class*="MessageContent"]',
      '[class*="message_content"]',
      '[class*="message-body"]',
      '[class*="MessageBody"]',
      '[class*="message_body"]',
      '[class*="prose"]',
      '[class*="Prose"]',
      '[class*="human-turn"]',
      '[class*="ai-turn"]',
      '[class*="assistant-turn"]',
      '[class*="user-turn"]',
      '[class*="chat-turn"]',
      '[class*="turn-"]',
      '[class*="Turn-"]',
      '[class*="message-"]',
      '[class*="Message-"]',
      '[class*="bubble"]',
      '[class*="Bubble"]',
      'article',
      '[role="article"]'
    ];

    let candidates = [];
    const main = document.querySelector('main') || document.body;
    for (const sel of genericSelectors) {
      try {
        const found = Array.from(main.querySelectorAll(sel));
        candidates = candidates.concat(found);
      } catch {}
    }

    candidates = Array.from(new Set(candidates));

    const outermost = candidates.filter(el => {
      if (el.offsetHeight === 0 && el.offsetWidth === 0) return false;
      const text = el.textContent?.trim() || '';
      if (text.length === 0) return false;

      // Filter out inputs, textareas, editable areas, headers, navigation bars, and sidebars
      if (el.closest('textarea, input, [contenteditable="true"], header, nav, [role="navigation"], .sidebar, [class*="sidebar"]')) {
        return false;
      }

      let parent = el.parentElement;
      while (parent && parent !== main) {
        if (candidates.includes(parent)) {
          return false;
        }
        parent = parent.parentElement;
      }
      return true;
    });

    if (outermost.length > 0) {
      outermost.sort((a, b) => {
        const pos = a.compareDocumentPosition(b);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      const messages = [];
      let expectedRole = 'user';

      for (let i = 0; i < outermost.length; i++) {
        const el = outermost[i];
        let role = null;

        const classStr = (el.className || '').toString().toLowerCase();
        const testid = (el.getAttribute('data-testid') || '').toLowerCase();

        if (testid.includes('human') || testid.includes('user') ||
            classStr.includes('human') || classStr.includes('user') || classStr.includes('prompt')) {
          role = 'user';
        } else if (testid.includes('ai') || testid.includes('assistant') || testid.includes('bot') ||
                   classStr.includes('ai') || classStr.includes('assistant') || classStr.includes('bot') ||
                   classStr.includes('font-claude') || classStr.includes('response')) {
          role = 'assistant';
        }

        if (!role) {
          role = expectedRole;
        }

        expectedRole = (role === 'user') ? 'assistant' : 'user';
        messages.push(this._buildMessage(el, role));
      }
      return messages;
    }

    return [];
  }

  /**
   * Merge user + assistant node lists, sort by DOM order, build messages.
   * Using compareDocumentPosition guarantees correct interleaving regardless
   * of how the arrays were assembled.
   *
   * @param {{ node: Element, role: string }[]} userItems
   * @param {{ node: Element, role: string }[]} assistantItems
   */
  _mergeAndBuild(userItems, assistantItems) {
    const all = [...userItems, ...assistantItems].sort((a, b) => {
      const pos = a.node.compareDocumentPosition(b.node);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return all.map(({ node, role }) => this._buildMessage(node, role));
  }

  /**
   * Build a message descriptor.
   * Extracts prose text + rich content from the message body child.
   * Also extracts Claude artifacts from the turn container.
   *
   * @param {Element} turnNode
   * @param {string}  role
   */
  _buildMessage(turnNode, role) {
    // Prefer the prose content child for clean text
    const contentEl = turnNode.querySelector(
      '.font-claude-message, [class*="prose"], [class*="message-content"]'
    ) || turnNode;

    const rich      = this.extractMessageContent(contentEl);
    const artifacts = role === 'assistant' ? this.extractArtifacts(turnNode) : [];

    return {
      role,
      content:    rich.text,
      codeBlocks: rich.codeBlocks,
      tables:     rich.tables,
      hasMath:    rich.hasMath,
      artifacts,
      node:       turnNode,
    };
  }

  /**
   * Extract Claude artifacts from a turn node.
   *
   * Artifacts are first-class content in Claude — code files, HTML previews,
   * React components, SVG graphics generated by the assistant.
   *
   * Claude renders artifact previews inline inside the turn (a smaller
   * preview card) even though the full artifact panel is a separate element.
   * We capture content from the inline preview block which contains the
   * complete source.
   *
   * Selectors (verified May 2025):
   *   [data-testid^="artifact"]  — testid-based artifact containers
   *   [class*="artifact"]        — class-based fallback
   *
   * @param {Element} turnNode
   * @returns {{ title: string, content: string, language: string, type: string }[]}
   */
  extractArtifacts(turnNode) {
    const artifacts = [];
    const seen      = new Set();

    // Collect artifact containers from the turn
    const containers = Array.from(turnNode.querySelectorAll(
      '[data-testid^="artifact"], [class*="artifact-content"], [class*="artifact-card"],' +
      '[class*="ArtifactContent"], [class*="artifact-preview"]'
    ));

    for (const container of containers) {
      // Title — look for header / label elements
      const titleEl = container.querySelector(
        '[class*="artifact-title"], [class*="artifact-header"], ' +
        '[class*="ArtifactTitle"], [class*="ArtifactHeader"], h2, h3'
      );
      const title = titleEl?.textContent?.trim() || 'Artifact';

      // Code content — prefer <pre><code> blocks inside the artifact
      const preCode = container.querySelector('pre code');
      const pre     = container.querySelector('pre');
      const codeEl  = preCode || pre;
      const content = codeEl?.textContent?.trim() ||
                      container.textContent?.trim() || '';

      if (!content || seen.has(content)) continue;
      seen.add(content);

      // Language from class name
      const langClass = (codeEl?.getAttribute('class') || '')
        .match(/language-(\w[\w-]*)/)?.[1] || '';

      // Artifact type heuristic
      let type = 'code';
      if (langClass === 'html' || container.querySelector('iframe')) type = 'html';
      else if (langClass === 'jsx' || langClass === 'tsx')           type = 'react';
      else if (langClass === 'svg' || content.trimStart().startsWith('<svg')) type = 'svg';
      else if (langClass === 'markdown' || langClass === 'md')       type = 'markdown';

      artifacts.push({
        title,
        content,
        language: langClass || 'text',
        type,
      });
    }

    return artifacts;
  }

  getMessageCount() {
    return this.getMessages().length;
  }

  getInputEl() {
    return this.queryFirst([
      'div[contenteditable="true"][class*="ProseMirror"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="Talk to Claude"]',
      'textarea[placeholder]',
      'textarea',
    ]);
  }

  insert(text) {
    const el = this.getInputEl();
    if (!el) return;
    el.focus();

    if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
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
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          }));
          return;
        }
      } catch (e) {
        console.warn('[Synapse] Claude execCommand failed, using fallback:', e);
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
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }));

        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        console.error('[Synapse] Fallback structural insert failed:', e);
      }
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
      'button[aria-label="Send Message"]',
      'button[aria-label="Send"]',
      'button[data-testid="send-button"]',
      'button[type="submit"]',
      'button[class*="send"]',
    ]);
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      // Fallback: dispatch Enter keypress on input if button not click-ready or disabled
      const input = this.getInputEl();
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, composed: true
        }));
      }
    }
  }

  /**
   * Claude scroll container fix.
   *
   * Claude's conversation scroll pane is inside <main>.
   * We scope overflow-y-auto search to <main> to avoid false matches.
   */
  _getScroller() {
    const main = document.querySelector('main');
    if (main) {
      const inner = main.querySelector('[class*="overflow-y-auto"]') ||
                    main.querySelector('[class*="overflow-y-scroll"]') ||
                    main.querySelector('[class*="overflow-auto"]');
      if (inner) return inner;
      return main;
    }
    return document.documentElement;
  }

  async scrollToBottom() {
    const s = this._getScroller();
    if (s) { s.scrollTop = s.scrollHeight; await this._waitForDOMStable(600); }
  }

  async waitForResponse() {
    return new Promise(resolve => {
      let checks = 0;
      const iv = setInterval(() => {
        const generating = document.querySelector(
          '[data-is-streaming="true"], ' +
          'button[aria-label*="Stop"], ' +
          '[class*="streaming"], ' +
          '[class*="generating"]'
        );
        if (!generating || ++checks > 90) { clearInterval(iv); resolve(); }
      }, 500);
    });
  }

  clear()          {}
  async cleanup()  {}
  async prepare()  {}
}
