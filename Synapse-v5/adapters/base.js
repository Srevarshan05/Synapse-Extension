/**
 * Synapse v3 — Base Adapter
 *
 * Fixes in this version:
 *   - _waitForDOMStable() now uses MutationObserver instead of fixed sleep,
 *     so extraction only begins when the DOM has actually settled.
 *   - extractMessageContent() fixes the code-block selector:
 *     the old 'pre code, pre, code' query double-counted every block
 *     inside a <pre><code> structure. The new approach selects <pre>
 *     elements first (preferring the inner <code> if present), then
 *     standalone <code> elements that are NOT inside a <pre>.
 *   - loadFullConversation() adds an explicit upward-sweep phase so that
 *     platforms that load historical messages on scroll-to-top (e.g.
 *     ChatGPT's infinite-scroll-up) are fully loaded before the downward
 *     sweep begins.
 */

export class BaseAdapter {
  constructor(platformId) {
    this.platformId = platformId;
  }

  detect(hostname = '') { return false; }

  getChatRoot() { return null; }

  /** Return raw message nodes with role + node reference */
  getMessages() { return []; }

  /** Return total visible message count (for completeness check) */
  getMessageCount() {
    return this.getMessages().length;
  }

  /**
   * Extract rich content from a message node.
   * Gets plain text + code blocks + tables + markdown structure.
   *
   * Code-block deduplication fix:
   *   Old: querySelectorAll('pre code, pre, code')
   *        → for <pre><code>…</code></pre>, BOTH the <pre> and the <code>
   *          were matched and pushed as separate blocks (2× duplication).
   *   New: Collect <pre> elements first.  If a <pre> contains a <code>,
   *        use the <code>'s text (cleaner).  Then collect standalone
   *        <code> elements (not inside any <pre>).
   *
   * @param {Element} node
   * @returns {{ text: string, codeBlocks: Array, tables: Array, hasTable: boolean, hasMath: boolean }}
   */
  extractMessageContent(node) {
    if (!node) return { text: '', codeBlocks: [], tables: [], hasTable: false, hasMath: false };

    // ── Code blocks (deduplicated) ─────────────────────────────────────────
    const codeBlocks = [];
    const seen = new Set(); // deduplicate by trimmed content

    // 1. All <pre> blocks (check for inner <code> to get language hint)
    node.querySelectorAll('pre').forEach(pre => {
      const inner = pre.querySelector('code');
      const target = inner || pre;
      const lang = (inner?.getAttribute('class') ?? pre.getAttribute('class') ?? '')
        .match(/language-(\w[\w-]*)/)?.[1] || 'text';
      const code = target.textContent?.trim() ?? '';
      if (code.length > 0 && !seen.has(code)) {
        seen.add(code);
        codeBlocks.push({ language: lang, content: code });
      }
    });

    // 2. Standalone <code> elements (not inside any <pre>)
    node.querySelectorAll('code').forEach(el => {
      if (el.closest('pre')) return; // already captured above
      const code = el.textContent?.trim() ?? '';
      if (code.length > 0 && !seen.has(code)) {
        seen.add(code);
        codeBlocks.push({ language: 'text', content: code });
      }
    });

    // ── Tables → markdown-style rows ──────────────────────────────────────
    const tables = [];
    node.querySelectorAll('table').forEach(tbl => {
      const rows = [];
      tbl.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td'))
          .map(c => c.textContent?.trim() || '');
        rows.push(cells.join(' | '));
      });
      if (rows.length > 0) tables.push(rows.join('\n'));
    });

    // ── Math (KaTeX / MathJax) ────────────────────────────────────────────
    const hasMath = !!(node.querySelector('.katex, .MathJax, [class*="math"]'));

    // ── Full text ─────────────────────────────────────────────────────────
    // innerText preserves whitespace/newlines better than textContent
    const text = (node.innerText || node.textContent || '').trim();

    return { text, codeBlocks, tables, hasTable: tables.length > 0, hasMath };
  }

  getInputEl() { return null; }

  async prepare() {}

  insert(text) {}

  submit() {}

  async waitForResponse() {}

  clear() {}

  async cleanup() {}

  // ── Scroll helpers ───────────────────────────────────────────────────────

  async scrollToTop() {
    const scroller = this._getScroller();
    if (scroller) {
      scroller.scrollTop = 0;
      await this._waitForDOMStable(800);
    }
  }

  async scrollToBottom() {
    const scroller = this._getScroller();
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      await this._waitForDOMStable(500);
    }
  }

  /**
   * Progressive scroll: loads the full conversation history.
   *
   * Two-phase strategy:
   *   Phase A — Upward sweep: scroll to top repeatedly until the message
   *             count stops growing.  This triggers "load older messages"
   *             pagination used by ChatGPT and similar platforms.
   *   Phase B — Downward sweep: scroll from top to bottom in viewport-
   *             sized chunks.  Triggers lazy image loading and ensures
   *             every message turn is in the DOM.
   *
   * Termination: 3 consecutive passes with no new messages discovered.
   *
   * @param {(count: number) => void} [onProgress]
   */
  async loadFullConversation(onProgress) {
    const scroller = this._getScroller();
    if (!scroller) {
      await this._waitForDOMStable(1000);
      if (onProgress) onProgress(this.getMessageCount());
      return;
    }

    const report = (label) => {
      const count = this.getMessageCount();
      if (onProgress) onProgress(count);
      return count;
    };

    // Helper to scroll the first loaded message bubble into view to force scroller top
    const forceScrollToTop = async () => {
      const messages = this.getMessages();
      if (messages.length > 0 && messages[0].node) {
        try {
          messages[0].node.scrollIntoView({ behavior: 'auto', block: 'start' });
        } catch (e) {
          scroller.scrollTop = 0;
        }
      } else {
        scroller.scrollTop = 0;
      }
    };

    // ── Phase A: Upward sweep (load historical messages) ──────────────────
    await forceScrollToTop();
    await this._waitForDOMStable(1200);

    let prevCount = -1;
    let upStable  = 0;
    const MAX_UP_STABLE = 4; // 4 consecutive stable passes → top is fully loaded

    while (upStable < MAX_UP_STABLE) {
      const count = report('up-sweep');
      if (count === prevCount) {
        upStable++;
      } else {
        upStable  = 0;
        prevCount = count;
      }
      // Force-scroll to absolute top to trigger lazy historical loading
      await forceScrollToTop();
      await this._waitForDOMStable(800);
    }

    // ── Phase B: Downward sweep (trigger lazy images / render all turns) ──
    const CHUNK = Math.max(scroller.clientHeight * 0.8, 600);
    let lastCount  = -1;
    let downStable = 0;
    const MAX_DOWN_STABLE = 3;

    while (downStable < MAX_DOWN_STABLE) {
      const count = report('down-sweep');
      if (count === lastCount) {
        downStable++;
      } else {
        downStable = 0;
        lastCount  = count;
      }

      scroller.scrollTop += CHUNK;
      await this._waitForDOMStable(700);

      // If we hit the bottom, do one final wait and recheck
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 50) {
        await this._waitForDOMStable(1000);
        const finalCount = report('bottom');
        if (finalCount === lastCount) break;
        lastCount = finalCount;
      }
    }

    // Return to top so extraction indexes from message 1
    await forceScrollToTop();
    await this._waitForDOMStable(500);
  }

  /**
   * Return the scrollable container for this platform.
   * Override in adapters that have platform-specific containers.
   */
  _getScroller() {
    return (
      document.querySelector('main') ||
      document.querySelector('[class*="overflow-y-auto"]') ||
      document.querySelector('[class*="scroll"]') ||
      document.scrollingElement ||
      document.documentElement
    );
  }

  /**
   * Wait until the DOM has settled (mutations stop for `quietMs`) OR
   * `maxWait` has elapsed — whichever comes first.
   *
   * Unlike the previous fixed setTimeout, this observer-based approach
   * returns early when the DOM is actually stable, and caps out safely.
   *
   * @param {number} minWait   Minimum guaranteed wait in ms (default 300)
   * @param {number} maxWait   Hard cap in ms (default 4000)
   * @param {number} quietMs   Settle window — ms of silence before resolving (default 250)
   */
  _waitForDOMStable(minWait = 300, maxWait = 4000, quietMs = 250) {
    return new Promise(resolve => {
      let observer;

      // Hard cap — always resolves within maxWait
      const hardTimer = setTimeout(() => {
        if (observer) observer.disconnect();
        resolve();
      }, maxWait);

      // Debounce timer — resets on every mutation
      let debounce = setTimeout(() => {
        if (observer) observer.disconnect();
        clearTimeout(hardTimer);
        resolve();
      }, Math.max(minWait, quietMs));

      observer = new MutationObserver(() => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          if (observer) observer.disconnect();
          clearTimeout(hardTimer);
          resolve();
        }, quietMs);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree:   true,
        attributes: false, // don't track attr changes (too noisy)
      });
    });
  }

  /** Try selectors in order, return first match */
  queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch { /* invalid selector — skip */ }
    }
    return null;
  }

  /** Try selectors in order, return all matches from the first selector that yields results */
  queryAll(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const els = Array.from(root.querySelectorAll(sel));
        if (els.length > 0) return els;
      } catch { /* invalid selector — skip */ }
    }
    return [];
  }

  /**
   * Deep Shadow DOM piercing querySelectorAll.
   * Recursively traverses light DOM and shadowRoot children to match all instances of the selector.
   *
   * @param {string}  selector  Standard CSS selector
   * @param {Element} root      Root element to search from (defaults to document)
   * @returns {Element[]}       Array of matching elements found across all DOM scopes
   */
  queryAllPiercing(selector, root = document) {
    const results = [];
    
    function search(node) {
      if (!node) return;

      // 1. Query current light/shadow DOM scope
      try {
        const matches = node.querySelectorAll(selector);
        matches.forEach(el => {
          if (!results.includes(el)) results.push(el);
        });
      } catch { /* invalid selector */ }

      // 2. Pierce shadowRoot if present
      if (node.shadowRoot) {
        search(node.shadowRoot);
      }

      // 3. Recurse down children in current light DOM scope
      let child = node.firstElementChild;
      while (child) {
        search(child);
        child = child.nextElementSibling;
      }
    }

    search(root);
    return results;
  }
}
