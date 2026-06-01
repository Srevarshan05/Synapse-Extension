import { BaseAdapter } from './base.js';

export class GrokAdapter extends BaseAdapter {
  constructor() {
    super('grok');
  }

  detect(hostname) {
    return hostname.includes('grok.com') || hostname.includes('x.com');
  }

  getChatRoot() {
    return this.queryFirst(['main', '#react-root']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('[data-testid="message"], .message');
    return Array.from(nodes).map(node => {
      const isUser = node.getAttribute('data-author') === 'user' || node.classList.contains('user');
      return {
        role: isUser ? 'user' : 'assistant',
        content: node.innerText,
        node
      };
    });
  }

  getInputEl() {
    return this.queryFirst(['textarea', '[contenteditable="true"]']);
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
    const btn = this.queryFirst(['button[aria-label="Send"]', '[data-testid="send-button"]']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
