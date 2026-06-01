import { BaseAdapter } from './base.js';

export class PoeAdapter extends BaseAdapter {
  constructor() {
    super('poe');
  }

  detect(hostname) {
    return hostname.includes('poe.com');
  }

  getChatRoot() {
    return this.queryFirst(['main', '#__next']);
  }

  getMessages() {
    const nodes = document.querySelectorAll('.Message_botMessageBubble__aKccs, .Message_humanMessageBubble__Nld4j, [class*="message"]');
    return Array.from(nodes).map(node => {
      const isUser = node.className.includes('human') || node.className.includes('user');
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
    const btn = this.queryFirst(['button[aria-label="Send message"]', 'button[class*="send"]']);
    if (btn && !btn.disabled) btn.click();
  }

  async waitForResponse() {}
  clear() {}
  async scrollToBottom() {}
}
