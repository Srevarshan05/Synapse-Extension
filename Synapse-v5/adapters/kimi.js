import { BaseAdapter } from './base.js';

export class KimiAdapter extends BaseAdapter {
  constructor() {
    super('kimi');
  }

  detect(hostname) {
    return hostname.includes('kimi.moonshot.cn');
  }

  getChatRoot() {
    return this.queryFirst(['.chat-list', 'main']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('.chat-item, [class*="message"]');
    return Array.from(nodes).map(node => {
      const isUser = node.classList.contains('is-user') || node.innerText.includes('You');
      return {
        role: isUser ? 'user' : 'assistant',
        content: node.innerText,
        node
      };
    });
  }

  getInputEl() {
    return this.queryFirst(['textarea.editor', 'div[contenteditable="true"]']);
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
    const btn = this.queryFirst(['button.send-btn', '.send-button']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
