import { BaseAdapter } from './base.js';

export class QwenAdapter extends BaseAdapter {
  constructor() {
    super('qwen');
  }

  detect(hostname) {
    return hostname.includes('tongyi.aliyun.com') || hostname.includes('chat.qwenlm.ai');
  }

  getChatRoot() {
    return this.queryFirst(['main', '.chat-container']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('.message-item, [class*="message"]');
    return Array.from(nodes).map(node => {
      const isUser = node.classList.contains('user') || node.getAttribute('data-role') === 'user';
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
    const btn = this.queryFirst(['.send-btn', 'button[type="submit"]', 'button[aria-label="Send"]']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
