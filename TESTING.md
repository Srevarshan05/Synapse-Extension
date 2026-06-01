# Synapse v2 — Testing Guide

> Run through each test on a real browser session with real conversations.
> Do not rely on build logs alone — validate live behavior.

---

## Setup Checklist

- [ ] Chrome loaded with Synapse (extension folder via Load unpacked)
- [ ] Extension pinned to toolbar
- [ ] At least one supported platform open (ChatGPT, Claude, or Gemini)

---

## Test 1 — Smart Copy (Basic)

**Platform:** ChatGPT  
**Goal:** Capture a short conversation correctly

### Steps
1. Open a ChatGPT conversation with at least 5 messages
2. Click the Synapse icon in the toolbar
3. Click **Smart Copy**

### Expected
- Toast shows phase indicators:
  - `📡 Discovering conversation…`
  - `📜 Loading… X messages found`
  - `🔍 Extracting content…`
  - `✅ Verifying… X% complete`
  - `✅ Saved! X messages · X% complete`
- Capsule appears in popup with correct title
- Message count matches what's visible in the chat

### Pass criteria
- [ ] No error toast
- [ ] Message count correct (± 1)
- [ ] Title is the conversation title (not "Untitled Chat")
- [ ] Completeness ≥ 95%

---

## Test 2 — Smart Copy (Long Conversation)

**Platform:** ChatGPT or Claude  
**Goal:** Verify progressive scroll captures all messages

### Steps
1. Open a conversation with 30+ messages
2. Scroll to the bottom (let the page load fully)
3. Click **Smart Copy**

### Expected
- Loading toast shows increasing message counts as it scrolls
- Final saved count matches actual message count

### Pass criteria
- [ ] All messages captured (check count in popup card)
- [ ] No timeout error
- [ ] Completeness ≥ 90%

---

## Test 3 — Use Synapse (Silent Mode)

**Platform:** ChatGPT → continue on ChatGPT  
**Goal:** Context injected, AI continues naturally

### Steps
1. After saving a capsule (Test 1 or 2), open a **new** ChatGPT conversation
2. Open the Synapse popup
3. Confirm the correct capsule is selected
4. Mode: **Silent** (default)
5. Click **⚡ Use Synapse**

### Expected
- Popup shows `⚡ Injecting context…`
- ChatGPT's input field briefly shows content then clears
- ChatGPT sends a message and the AI responds
- AI response acknowledges the previous context naturally (no copy-paste feel)
- Popup closes automatically

### Pass criteria
- [ ] No error toast
- [ ] Input field is clear after submission (no giant text visible)
- [ ] AI responds and continues the topic
- [ ] Response does not say "I don't have context for this"

---

## Test 4 — Use Synapse (Cross-platform)

**Platform:** Capture on ChatGPT → inject into Claude  
**Goal:** Context transfers across platforms

### Steps
1. Save a capsule from ChatGPT (Test 1)
2. Open Claude in a new tab
3. Open Synapse popup
4. Select the ChatGPT capsule
5. Mode: **Silent**
6. Click **⚡ Use Synapse**

### Pass criteria
- [ ] Claude tab comes to focus
- [ ] Claude receives the context and responds
- [ ] Conversation continues naturally

---

## Test 5 — Preview Mode

**Goal:** Verify injection without auto-submit

### Steps
1. Select a capsule in popup
2. Change mode to **Preview**
3. Click **⚡ Use Synapse**

### Expected
- Context prompt appears in the input field
- Nothing is submitted automatically
- User can review the prompt text, then press Enter

### Pass criteria
- [ ] Input field shows the context text
- [ ] No automatic submission
- [ ] Text is compact (< 1000 chars)

---

## Test 6 — Dashboard: Capsule Library

### Steps
1. Click **Open Vault Dashboard →** in popup
2. Browse to Capsules view

### Pass criteria
- [ ] All saved capsules appear
- [ ] Title, platform badge, completeness bar correct
- [ ] Pin/unpin works
- [ ] Delete works (with confirmation modal)
- [ ] Search filters results correctly

---

## Test 7 — Export and Import

### Steps
1. Open Dashboard → Capsules
2. Hover a capsule card → click Export
3. Save the `.synapse` file
4. Delete the capsule
5. Click Import → select the file

### Pass criteria
- [ ] Export produces a valid file
- [ ] Import restores the capsule with correct title and message count

---

## Test 8 — Capture Accuracy (Code + Tables)

**Platform:** ChatGPT  
**Goal:** Code blocks and tables captured correctly

### Steps
1. Ask ChatGPT: "Write a Python fibonacci function and show a comparison table of O(n) algorithms"
2. After response appears, run Smart Copy

### Pass criteria
- [ ] Capsule saved successfully
- [ ] Code snippets field is populated (check via Export → inspect JSON)
- [ ] Message content includes the table text

---

## Test 9 — Replay (Large Chat)

**Platform:** ChatGPT  
**Goal:** Full conversation continuity after many messages

### Steps
1. Have a 50+ message conversation
2. Run Smart Copy
3. Open a new chat
4. Use Synapse (Silent)
5. Continue the topic with a new question

### Pass criteria
- [ ] AI recalls the topic from the injected context
- [ ] Continuation is coherent and on-topic
- [ ] No "I'm sorry, I don't have context" response

---

## Test 10 — Error Handling

### 10A: Use Synapse on non-LLM page
- Navigate to google.com
- Open popup → click Use Synapse
- **Expected:** `⚠️ Navigate to a supported LLM first.` toast

### 10B: Smart Copy with no messages
- Open ChatGPT but don't start a conversation
- Open popup → Smart Copy
- **Expected:** Error or `0 messages · 0% complete` (graceful)

### 10C: Platform tab closed during injection
- Start Use Synapse on a capsule
- Close the target platform tab mid-injection
- **Expected:** Error toast with descriptive message (no silent failure)

---

## Summary Table

| Test | Feature | Platform | Priority |
|---|---|---|---|
| 1 | Smart Copy basic | ChatGPT | 🔴 Critical |
| 2 | Smart Copy long chat | Any | 🔴 Critical |
| 3 | Use Synapse silent | ChatGPT | 🔴 Critical |
| 4 | Cross-platform inject | GPT→Claude | 🟠 High |
| 5 | Preview mode | Any | 🟡 Medium |
| 6 | Dashboard UI | — | 🟡 Medium |
| 7 | Export/Import | — | 🟡 Medium |
| 8 | Code+table capture | ChatGPT | 🟠 High |
| 9 | Large chat replay | ChatGPT | 🟠 High |
| 10 | Error handling | Various | 🟡 Medium |
