import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

// Mock chrome API for the extension modules before importing them
global.chrome = {
  runtime: {
    sendMessage: () => {}
  }
};

// Polyfill text encoding if needed
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill requestAnimationFrame for global Node.js environment
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);

import { ChatGPTAdapter } from '../extension/adapters/chatgpt.js';
import { ClaudeAdapter } from '../extension/adapters/claude.js';
import { GeminiAdapter } from '../extension/adapters/gemini.js';
import { DeepSeekAdapter } from '../extension/adapters/deepseek.js';
import { capture } from '../extension/core/capture-engine.js';
import { hydrate } from '../extension/core/hydration-engine.js';
import { buildContinuationPrompt } from '../extension/core/continuation-compiler.js';

// Helper to set up a mock DOM environment for a given platform
function setupMockDOM(platform, messageCount = 10, withFiles = false, codeHeavy = false) {
  let html = `<!DOCTYPE html><html><body><main id="__next">`;
  html += `<div class="chat-container">`;

  for (let i = 0; i < messageCount; i++) {
    const isUser = i % 2 === 0;
    const roleAttr = platform === 'chatgpt' ? `data-message-author-role="${isUser ? 'user' : 'assistant'}"` : '';
    const classAttr = platform === 'claude' ? `class="${isUser ? 'font-user-message' : 'font-claude-message'}"` : '';

    let content = isUser ? `Message ${i}: I want to build a React component. We will use Tailwind.` : `Sure, I recommend using Vite. Here is the code.`;
    if (codeHeavy && !isUser) {
      content += `\n\`\`\`javascript\nconst x = ${i};\nconsole.log(x);\n\`\`\``;
    }

    let attachmentHTML = '';
    if (withFiles && isUser && i === 0) {
      attachmentHTML = `<a href="#" class="file-attachment" title="architecture.pdf">architecture.pdf</a>`;
    }

    if (platform === 'gemini') {
      if (isUser) {
        html += `<user-query class="user-query-container">${content} ${attachmentHTML}</user-query>`;
      } else {
        html += `<model-response class="model-response">${content} ${attachmentHTML}</model-response>`;
      }
    } else {
      html += `<div ${roleAttr} ${classAttr}>${content} ${attachmentHTML}</div>`;
    }
  }

  html += `</div>`;
  
  // Input area
  if (platform === 'chatgpt') html += `<textarea id="prompt-textarea"></textarea><button data-testid="send-button"></button>`;
  if (platform === 'claude') html += `<div contenteditable="true" class="ProseMirror"></div><button aria-label="Send Message"></button>`;
  if (platform === 'gemini') html += `<rich-textarea><div contenteditable="true" class="ql-editor"></div></rich-textarea><button aria-label="Send message"></button>`;
  if (platform === 'deepseek') html += `<textarea id="chat-input"></textarea><button id="send-button"></button>`;

  html += `</main></body></html>`;

  const dom = new JSDOM(html, { url: `https://${platform}.com/chat` });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.Node = dom.window.Node;
  global.Event = dom.window.Event;
  global.InputEvent = dom.window.InputEvent || dom.window.Event;
  
  // Polyfill scroll methods and window properties
  global.window.scrollTo = () => {};
  global.document.body.scrollTo = () => {};
  global.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

async function runScenario(name, sourcePlatform, destPlatform, msgCount, files, code) {
  console.log(`\n--- Running Scenario: ${name} ---`);
  
  let adapterMap = {
    'chatgpt': new ChatGPTAdapter(),
    'claude': new ClaudeAdapter(),
    'gemini': new GeminiAdapter(),
    'deepseek': new DeepSeekAdapter()
  };

  const srcAdapter = adapterMap[sourcePlatform];
  const destAdapter = adapterMap[destPlatform];

  // 1. CAPTURE
  setupMockDOM(sourcePlatform, msgCount, files, code);
  const captureStart = Date.now();
  let capsule;
  try {
    capsule = await capture(srcAdapter, 'standard');
  } catch (e) {
    console.error(`❌ Capture Failed:`, e);
    return { success: false, reason: 'Capture error' };
  }
  const captureTime = Date.now() - captureStart;

  // 2. VERIFY CAPSULE
  const capsuleStr = JSON.stringify(capsule);
  const capsuleSize = capsuleStr.length;
  if (capsule.memory === undefined) return { success: false, reason: 'No memory compiled' };

  // 3. HYDRATE
  setupMockDOM(destPlatform, 0); // Empty chat for destination
  const hydrateStart = Date.now();
  let hydrationReport;
  try {
    hydrationReport = await hydrate(destAdapter, capsule, 'interactive');
  } catch (e) {
    console.error(`❌ Hydrate Failed:`, e);
    return { success: false, reason: 'Hydration error' };
  }
  const hydrateTime = Date.now() - hydrateStart;

  // 4. VERIFY INJECTION (Check input textarea value)
  const inputEl = destAdapter.getInputEl();
  const injectedText = inputEl ? (inputEl.value || inputEl.innerText || inputEl.textContent) : '';
  
  if (!injectedText || injectedText.length === 0) {
    console.error(`❌ Failed: No text injected into adapter input`);
    return { success: false, reason: 'No text injected into adapter input' };
  }

  if (injectedText.includes('{') && injectedText.includes('}')) {
    // Basic check for raw JSON
    if (injectedText.includes('"platform"') || injectedText.includes('"memory"')) {
       console.error(`❌ Failed: Raw JSON leaked into prompt`);
       return { success: false, reason: 'Raw JSON leaked into prompt' };
    }
  }

  if (injectedText.length > 5000) {
    console.error(`❌ Failed: Giant pasted prompt detected`);
    return { success: false, reason: 'Giant pasted prompt detected' };
  }

  console.log(`✅ Success`);
  console.log(`   Capture: ${captureTime}ms | Hydrate: ${hydrateTime}ms | Size: ${(capsuleSize/1024).toFixed(1)}KB`);
  console.log(`   Injected Prompt Length: ${injectedText.length} chars`);
  
  return { success: true, captureTime, hydrateTime, size: capsuleSize };
}

async function main() {
  console.log(`[Synapse v2] Phase 3.5 End-to-End Validation\n`);
  
  let passes = 0;
  let total = 6;
  const metrics = [];

  // 1. ChatGPT -> Gemini
  const r1 = await runScenario('ChatGPT → Gemini', 'chatgpt', 'gemini', 10, false, false);
  if (r1.success) { passes++; metrics.push(r1); }

  // 2. Gemini -> Claude
  const r2 = await runScenario('Gemini → Claude', 'gemini', 'claude', 10, false, false);
  if (r2.success) { passes++; metrics.push(r2); }

  // 3. Claude -> DeepSeek
  const r3 = await runScenario('Claude → DeepSeek', 'claude', 'deepseek', 10, false, false);
  if (r3.success) { passes++; metrics.push(r3); }

  // 4. Long conversation (100+ messages)
  const r4 = await runScenario('Long Conversation (100 msgs)', 'chatgpt', 'chatgpt', 120, false, false);
  if (r4.success) { passes++; metrics.push(r4); }

  // 5. Code-heavy conversation
  const r5 = await runScenario('Code-Heavy Conversation', 'claude', 'gemini', 30, false, true);
  if (r5.success) { passes++; metrics.push(r5); }

  // 6. Conversation with uploaded files
  const r6 = await runScenario('File Attachments', 'chatgpt', 'claude', 10, true, false);
  if (r6.success) { passes++; metrics.push(r6); }

  console.log(`\n=== VALIDATION REPORT ===`);
  const passRate = (passes / total) * 100;
  console.log(`Pass Rate: ${passRate.toFixed(1)}% (${passes}/${total})`);
  
  if (passes > 0) {
    const avgCap = metrics.reduce((acc, m) => acc + m.captureTime, 0) / passes;
    const avgHyd = metrics.reduce((acc, m) => acc + m.hydrateTime, 0) / passes;
    const avgSize = metrics.reduce((acc, m) => acc + m.size, 0) / passes;
    console.log(`Avg Capture Time: ${avgCap.toFixed(1)}ms`);
    console.log(`Avg Hydrate Time: ${avgHyd.toFixed(1)}ms`);
    console.log(`Avg Capsule Size: ${(avgSize/1024).toFixed(1)}KB`);
  }

  if (passRate >= 90) {
    console.log(`\nRESULT: PASS ✅`);
  } else {
    console.log(`\nRESULT: FAIL ❌`);
    process.exit(1);
  }
}

main().catch(console.error);
