import { BaseAdapter } from './base.js';

export class CopilotAdapter extends BaseAdapter {
  constructor() {
    super('copilot');
  }

  detect(hostname) {
    return hostname.includes('copilot.microsoft.com');
  }

  getChatRoot() {
    return this.queryFirst(['cib-serp', 'main']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('cib-message, .message');
    return Array.from(nodes).map(node => {
      const isUser = node.getAttribute('source') === 'user' || node.classList.contains('user');
      return {
        role: isUser ? 'user' : 'assistant',
        content: node.innerText,
        node
      };
    });
  }

  getInputEl() {
    return this.queryFirst(['textarea', 'cib-text-input']);
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
    const btn = this.queryFirst(['button[aria-label="Submit"]', 'cib-icon-button[icon="send"]']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
