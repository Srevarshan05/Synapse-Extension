import { BaseAdapter } from './base.js';

export class PerplexityAdapter extends BaseAdapter {
  constructor() {
    super('perplexity');
  }

  detect(hostname) {
    return hostname.includes('perplexity.ai');
  }

  getChatRoot() {
    return this.queryFirst(['main', '.thread-content']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('.message, [dir="auto"]');
    return Array.from(nodes).map(node => {
      const isUser = node.closest('.user-message') || node.classList.contains('user');
      return {
        role: isUser ? 'user' : 'assistant',
        content: node.innerText,
        node
      };
    });
  }

  getInputEl() {
    return this.queryFirst(['textarea', 'div[contenteditable="true"]']);
  }

  insert(text) {
    const inputEl = this.getInputEl();
    if (inputEl) {
      if (inputEl.tagName === 'TEXTAREA') {
        inputEl.value = text;
      } else {
        inputEl.textContent = text;
      }
      inputEl.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  }

  submit() {
    const btn = this.queryFirst(['button[aria-label="Submit"]', '.send-button']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
