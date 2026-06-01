import { BaseAdapter } from './base.js';

export class MistralAdapter extends BaseAdapter {
  constructor() {
    super('mistral');
  }

  detect(hostname) {
    return hostname.includes('chat.mistral.ai');
  }

  getChatRoot() {
    return this.queryFirst(['main', '.messages']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('.message, [data-role]');
    return Array.from(nodes).map(node => {
      const isUser = node.getAttribute('data-role') === 'user' || node.classList.contains('user-message');
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
    const btn = this.queryFirst(['button[aria-label="Send"]', 'button[type="submit"]']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
