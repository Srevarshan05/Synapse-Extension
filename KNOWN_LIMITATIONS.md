# Synapse v3 — Known Limitations

> This document lists known limitations in v3.0.0.
> These are addressed dynamically in subsequent releases.

---

## Platform Limitations

### ChatGPT
- **Temporary chats**: Synapse cannot capture "Temporary Chat" sessions (no persistent DOM)
- **Canvas / Artifacts**: Canvas content (side panel) is not captured — only inline chat is extracted
- **Voice mode**: Voice conversations have no text DOM and cannot be captured
- **File contents**: Uploaded files shown in the file pill UI are captured by metadata only (name, type), not content — unless `deep` capture mode is enabled and the file blob is accessible

### Claude
- **Artifacts sidebar**: Claude's artifact panel (code, HTML, SVG) is now fully extracted as structured content in the capsule schema, though interactive React live previews are not executed offline
- **Projects**: Project-level context (custom instructions) is not captured
- **Very long responses**: Claude responses exceeding 10,000 characters may be partially truncated in the continuation tail

### Gemini
- **Gemini Advanced extensions** (Google Workspace integration): content from Google Docs/Sheets referenced in chat is not extracted
- **Image generation output**: Generated images are now fully captured as base64 blobs (no longer just alt-text)
- **Citations and Grounding**: Source chips and grounding search references are fully extracted, but dynamic third-party link content inside external tabs remains un-crawled
- **Multi-modal inputs**: Image inputs by the user are noted by position but not stored as blobs

### All Platforms
- **Streaming responses**: If Smart Copy is triggered while the AI is still generating, the in-progress message may be captured partially. Wait for the response to finish before capturing.
- **Rate limits**: Platforms may rate-limit the DOM scroll events during progressive capture on very large conversations (1000+ messages). A retry usually resolves this.

---

## File & Attachment Limits

| File Type | Standard Mode | Deep Mode |
|---|---|---|
| PDF | Metadata only | Text extracted (< 10MB) |
| DOCX | Metadata only | Text extracted (< 10MB) |
| TXT | Metadata only | Full text |
| CSV | Metadata only | Full text |
| PNG/JPG/GIF | Metadata + alt-text | Same |
| ZIP/RAR | Metadata only | ❌ Not extracted |
| MP4/MP3 | Metadata only | ❌ Not extracted |
| EXE/DMG | Metadata only | ❌ Not extracted |
| Files > 10MB | Metadata only | Partial (first 10MB) |

---

## Capture Limits

| Limit | Value | Notes |
|---|---|---|
| Max messages per capture | No hard limit | Performance degrades above ~2000 messages |
| Max attachments per capture | 100 | Configurable in source |
| Max capsule body size | ~50MB (raw) | Compressed to ~5–10MB typically |
| Continuation tail | Last 10 messages | Only last 10 are used for hydration context |
| Code snippets stored | 50 per capsule | Deduped by content hash |
| Hydration prompt size | 1000 chars max | Target 300–600 chars |

---

## Storage Limitations

- **IndexedDB max size**: Browser-dependent, typically 60–80% of available disk space. Chrome will prompt the user if storage quota is exceeded.
- **No cloud sync**: Capsules are stored locally only. Uninstalling the extension **permanently deletes all capsules** unless you export them first.
- **No cross-device sync**: There is no sync between different Chrome profiles or machines. Use Export/Import to transfer capsules manually.

---

## Injection Limitations

- **Platform input detection**: If a platform redesigns its input field DOM between extension updates, injection may fail. Workaround: use **Preview mode** and manually submit.
- **Rate-limited accounts**: Some platforms may throttle rapid message submissions. In this case, switch to **Preview mode** and press Enter manually.
- **Two-factor or locked chats**: Injection targets a new chat. If the platform requires a payment prompt or 2FA step before allowing messages, injection will fail with a timeout.

---

## Security Notes

- Encryption is **per-device** — capsules exported from one device cannot be decrypted on another device without exporting the key manually (not yet exposed in UI — planned for v2.1)
- The **secret redaction** engine uses regex patterns. Unusual API key formats may not be caught.

---

## Not Supported in v3.0.0

The following features are **planned but not included** in v3.0.0:

- [ ] Cross-device sync (planned: v3.2)
- [ ] Cloud backup / optional server (planned: v3.3)
- [ ] Manual key export for cross-device decryption (planned: v3.1)
- [ ] Firefox / Edge support (planned: v3.2)
- [ ] Selective message capture (planned: v3.1)
- [ ] Conversation search within capsule body (planned: v3.1)
