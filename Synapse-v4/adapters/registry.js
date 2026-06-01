import { ChatGPTAdapter } from './chatgpt.js';
import { ClaudeAdapter } from './claude.js';
import { GeminiAdapter } from './gemini.js';
import { DeepSeekAdapter } from './deepseek.js';
import { KimiAdapter } from './kimi.js';
import { GrokAdapter } from './grok.js';
import { CopilotAdapter } from './copilot.js';
import { PerplexityAdapter } from './perplexity.js';
import { PoeAdapter } from './poe.js';
import { OpenRouterAdapter } from './openrouter.js';
import { MistralAdapter } from './mistral.js';
import { QwenAdapter } from './qwen.js';

export function getAdapterForHostname(hostname) {
  const adapters = [
    new ChatGPTAdapter(),
    new ClaudeAdapter(),
    new GeminiAdapter(),
    new DeepSeekAdapter(),
    new KimiAdapter(),
    new GrokAdapter(),
    new CopilotAdapter(),
    new PerplexityAdapter(),
    new PoeAdapter(),
    new OpenRouterAdapter(),
    new MistralAdapter(),
    new QwenAdapter()
  ];

  for (const adapter of adapters) {
    if (adapter.detect(hostname)) {
      return adapter;
    }
  }
  return null;
}
