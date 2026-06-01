# Changelog

All notable changes to Synapse are documented here.

---

## [2.0.0-rc1] — 2026-05-25

### Release Candidate 1

This is the first release candidate for Synapse v2 — a complete ground-up rewrite from v1.

---

### Added

#### Capture Engine (Redesigned)
- **Progressive scroll capture**: scrolls top→bottom in chunks, waits for DOM stability between passes — never captures viewport-only
- **Rich content extraction**: captures text, code blocks (with language tags), tables (markdown format), math/KaTeX flags, and attachment metadata
- **Completeness verification**: warns user if capture is < 95% complete
- **Dynamic worker allocation**: 2/4/6 workers based on `navigator.hardwareConcurrency`
- **Continuation tail**: last 10 messages preserved separately for accurate hydration
- **Title extraction**: multi-source (document title, h1, sidebar, with platform suffix removal)
- **Code deduplication**: cross-message code block deduplication by content hash

#### Hydration Engine (Redesigned)
- **DOM-native injection**: uses React's `nativeInputValueSetter` and contentEditable APIs — not copy-paste
- **Tiny payload**: 300–600 chars, hard cap 1000 chars — never injects full transcript
- **Auto-submit**: fires after injection in Silent mode
- **Textarea clear**: input box cleared after submit so user never sees injected prompt
- **Full adapter flow**: `prepare() → inject() → submit() → wait() → cleanup()`

#### Continuation Compiler (Redesigned)
- **Structured prompt format**: Topic + Context bullets + Rules
- **Max 5 bullets** from goals/decisions/constraints/open questions
- **1000 char hard cap** — always compact and clean
- **No transcript injection**: never dumps raw messages

#### Popup (Redesigned)
- **Current Capsule selector**: shows most recent capsule, switchable list
- **Mode tabs**: Preview / Silent / Interactive (default: Silent)
- **⚡ Use Synapse** — primary CTA button
- **Live capture progress**: phase indicators during Smart Copy
- **Completeness feedback**: shows message count + % after save
- **Low completeness warning** shown inline

#### Adapters (Hardened)
- **ChatGPT**: multi-strategy selectors (data-message-author-role, conversation-turn, group/conversation-turn)
- **Claude**: updated for Claude 3.5+ (data-test-render-count, ProseMirror contenteditable)
- **Gemini**: web component selectors (user-query, model-response) with document-order interleaving

#### Background Service Worker
- **Inline compression**: CompressionStream runs directly in service worker — removed fragile offscreen→worker pipeline
- **CAPSULE_INJECT**: finds/opens platform tab, injects content script, fires hydration
- **All handlers async-safe**: every handler properly awaited and error-wrapped

#### Storage
- **fullConversation** stored (not summarized before save)
- **continuationTail** (last 10 messages) stored separately
- **code.snippets** stored as first-class field
- **IndexedDB chunked storage**: 1MB chunks, reassembled on read

#### Dashboard
- **⚡ Use in Chat** button on every capsule card
- **Platform picker modal**: choose destination platform
- **Injection status feedback**: inline success/error per card

---

### Fixed
- `CAPSULE_SAVE` timeout — eliminated offscreen compression pipeline
- `IDBObjectStore key path` error — capsule `id` now always generated before save
- `Could not establish connection` — popup now injects content script programmatically
- `Service worker registration failed` — background.js simplified, no dynamic imports at runtime
- ChatGPT message capture returning 0 — updated to multi-strategy selectors
- IndexedDB deadlock on extension reload — 5s timeout with clear error message

---

### Architecture Changes
- Removed offscreen document dependency for compression
- Removed web worker for compression (CompressionStream in service worker)
- Background.js reduced from 637 → ~450 lines with cleaner handler dispatch

---

## [1.x] — Legacy

v1 used `chrome.storage.local` with no encryption, no compression, and no cross-platform support. Migration from v1 → v2 runs automatically on extension update.
