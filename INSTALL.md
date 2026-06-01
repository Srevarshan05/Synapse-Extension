# Synapse v2 — Installation Guide

## Option A: Load Pre-built Extension (Recommended for Testing)

The `extension/` folder inside the zip is already fully built.
No Node.js or npm required.

### Steps

**1. Open Chrome Extensions**
```
chrome://extensions
```

**2. Enable Developer Mode**

Toggle the **Developer mode** switch in the top-right corner.

**3. Click "Load unpacked"**

Click the **Load unpacked** button that appears on the left.

**4. Select the `extension` folder**

Navigate to where you extracted the zip and select the **`extension`** folder
(the one that contains `manifest.json`).

> ⚠️ Do NOT select the root `Synapse-Extension` folder — select only the `extension/` subfolder.

**5. Verify installation**

You should see the **Synapse** card appear in the extensions list.
The status should show **"Active"**.

**6. Pin the extension** (optional but recommended)

Click the puzzle-piece icon (🧩) in Chrome's toolbar → click the pin icon next to Synapse.

---

## Option B: Build from Source

If you want to build from source (after making changes):

### Prerequisites
- Node.js 18+
- npm 9+

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Full build
npm run build

# 3. Validate output
npm run validate

# 4. Load the built extension/folder in Chrome (see Option A, steps 1-6)
```

---

## Updating the Extension

When you receive a new version:

1. Extract the new zip
2. Go to `chrome://extensions`
3. Find Synapse → click the **Reload ↻** button
   - OR remove and re-add with **Load unpacked**

> **Important:** After reloading, **refresh any open LLM tabs** (F5) so the content script updates.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Could not establish connection" | Refresh the LLM tab (F5) then try again |
| Extension not loading | Make sure you selected the `extension/` subfolder, not the root |
| Smart Copy captures 0 messages | Scroll down in the chat first, then try again |
| Use Synapse does nothing | Make sure you're on a supported platform tab |
| Dashboard not opening | Go to `chrome://extensions` → Reload Synapse |
