# Synapse: Universal Memory Layer Protocol

Synapse is a client-side, zero-knowledge context transfer framework designed to solve AI context loss. It enables developers to capture conversation states, prunes source code context (AST outlining) using local WebGPU/WASM pipelines on the edge, and seamlessly transfers the compressed memory capsules across different LLM platforms (ChatGPT, Claude, and Gemini) without manual switching or re-explaining code bases.

## Project Structure

```
├── extension/           # Chrome Manifest V3 Extension
│   ├── manifest.json
│   ├── content.js       # Live DOM selectors and button injection logic
│   ├── background.js    # Service worker handling IndexedDB storage & events
│   ├── offscreen.html   # Offscreen sandbox container
│   ├── offscreen.js     # AST pruning, embedding derivations (ONNX/WASM simulation)
│   ├── popup.html       # Popup vault viewer UI
│   └── popup.js         # Popup interaction handler
├── src/                 # Local React Diagnostic & Testing Dashboard
│   ├── App.jsx          # Dashboard application UI
│   ├── index.css        # Vanilla glassmorphic design token stylesheet
│   └── main.jsx
├── index.html
├── package.json
└── README.md
```

## Features

* **AST Outlining & Token Pruning:** Reduces context block sizes by up to **80%** by stripping implementation helper details and preserving function/class API outlines before transit.
* **Smart Copy:** Inline content-injection button added directly next to assistant speech boxes to capture context into the vault instantly.
* **Auto-Prompt Injection:** Injects a custom action button directly into chat prompt fields on Gemini, ChatGPT, and Claude to instantly retrieve and paste capsules.
* **E2EE Vector Database:** Offscreen browser sandbox indexes capsules securely using client-side Web Crypto PBKDF2/AES key derivation.

## How to Test

### 1. Run the Diagnostic Dashboard (React)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the local server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:5173/` in your browser.

### 2. Install the Chrome Extension
1. Open Google Chrome and go to `chrome://extensions/`.
2. Toggle **Developer mode** to **On** (top-right corner).
3. Click **Load unpacked** (top-left corner).
4. Select the `extension/` directory inside this project folder.
5. Open `https://gemini.google.com/` or `https://chatgpt.com/` to test live!

---

Developed as an open-source client-side memory layer. Secure by default, no servers, no API keys, runs 100% on device.
