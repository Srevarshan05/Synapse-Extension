# Synapse v2 — Universal LLM Context Continuity Engine

> Capture any conversation. Continue anywhere. Never lose context again.

![Version](https://img.shields.io/badge/version-2.0.0--rc1-purple)
![Platform](https://img.shields.io/badge/platform-Chrome%20MV3-blue)
![Storage](https://img.shields.io/badge/storage-Local%20IndexedDB-green)
![Encryption](https://img.shields.io/badge/encryption-AES--256--GCM-orange)

---

## What is Synapse?

Synapse is a Chrome extension that captures entire LLM conversations — all messages, code blocks, tables, and attachments — and lets you continue them on any supported AI platform in one click.

**Privacy-first:** All data is stored locally in your browser's IndexedDB. Nothing is sent to any server. Ever.

---

## Supported Platforms

| Platform | Capture | Inject |
|---|---|---|
| ChatGPT | ✅ | ✅ |
| Claude | ✅ | ✅ |
| Gemini | ✅ | ✅ |
| DeepSeek | ✅ | ✅ |
| Grok | ✅ | ✅ |
| Copilot | ✅ | ✅ |
| Perplexity | ✅ | ✅ |
| Poe | ✅ | ✅ |
| Mistral | ✅ | ✅ |
| Kimi | ✅ | ✅ |
| OpenRouter | ✅ | ✅ |
| Qwen | ✅ | ✅ |

---

## Core Features

### Smart Copy
Click **Smart Copy** in the popup while on any supported LLM page. Synapse will:
1. Scroll to the top of the conversation
2. Progressively load all messages (no viewport-only capture)
3. Extract text, code blocks, tables, math, and attachments
4. Verify completeness (warns if < 95%)
5. Compress and encrypt everything locally
6. Save to your personal vault

### Use Synapse
Select a saved capsule in the popup and click **Use Synapse**. Synapse will:
1. Inject a compact context-restoration prompt (300–600 chars, max 1000)
2. Submit it natively via the platform's DOM (not copy-paste)
3. The AI continues your conversation naturally

### Dashboard (Capsule Vault)
Browse, search, pin, export, and import all your saved conversations.

---

## Architecture

```
Chrome Extension (MV3)
├── background.js        — Service worker: message router, crypto, IDB storage
├── content.bundle.js    — Injected into LLM pages: capture + hydration
├── popup.html/js        — Extension popup: Smart Copy + Use Synapse
├── dashboard/           — React SPA: capsule vault UI
├── adapters/            — Per-platform DOM selectors
│   ├── chatgpt.js
│   ├── claude.js
│   ├── gemini.js
│   └── … (12 total)
└── core/
    ├── capture-engine.js     — Progressive scroll + extraction pipeline
    ├── hydration-engine.js   — DOM-native injection + submit + clear
    ├── continuation-compiler.js — Compact context prompt builder
    ├── storage.js            — IndexedDB CRUD layer
    ├── crypto.js             — AES-256-GCM encrypt/decrypt
    ├── context-compiler.js   — Memory/goal/decision extraction
    ├── attachment-engine.js  — File attachment extraction
    └── security.js           — API key / secret redaction
```

---

## Security

- **AES-256-GCM** encryption for all stored capsule bodies
- **Auto-generated** per-device encryption key (stored in IndexedDB settings)
- **Secret redaction**: API keys, tokens, and credentials are auto-redacted before storage
- **No network requests**: the extension makes zero outbound requests to any Synapse server
- **Local-first**: your data never leaves your browser

---

## Development

### Prerequisites
- Node.js 18+
- npm 9+
- Google Chrome 115+

### Setup
```bash
git clone <repo>
cd Synapse-Extension
npm install
npm run build
```

### Load in Chrome
See [INSTALL.md](./INSTALL.md) for step-by-step instructions.

### Build commands
```bash
npm run build:content    # Build content.bundle.js
npm run build:dashboard  # Build React dashboard
npm run build:workers    # Build web workers
npm run build            # Full build (all of the above)
npm run validate         # Build + validate output
```

---

## License

MIT — see [LICENSE](./LICENSE)
