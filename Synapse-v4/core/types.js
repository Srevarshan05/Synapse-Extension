/**
 * Synapse v3 — JSDoc Type Definitions
 * All core types used throughout the extension and dashboard.
 * This file is documentation only — no runtime logic.
 */

/**
 * @typedef {Object} CapsuleVersion
 * @property {number} schema   - Capsule format version (v1 migrated = 1, native v2 = 2)
 * @property {number} adapter  - Adapter version that produced the capture
 * @property {number} extractor - Content extractor version
 */

/**
 * @typedef {'fast'|'standard'|'deep'} CaptureLevel
 * - fast: messages only (~instant)
 * - standard: messages + code + attachment metadata (5–15s)
 * - deep: + PDF, DOCX, OCR, full extraction (may take minutes)
 */

/**
 * @typedef {'chatgpt'|'claude'|'gemini'|'deepseek'|'kimi'|'grok'|'copilot'|'perplexity'|'poe'|'openrouter'|'mistral'|'qwen'|'unknown'} PlatformId
 */

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 * @property {number} [timestamp]
 * @property {CodeBlock[]} [codeBlocks]
 * @property {string[]} [attachmentIds]  - IDs of attachments referenced in this message
 */

/**
 * @typedef {Object} CodeBlock
 * @property {string} language
 * @property {string} content
 * @property {number} [lineCount]
 */

/**
 * @typedef {Object} CodeSnippet
 * @property {string} language
 * @property {string} content
 * @property {string} [filename]
 * @property {number} messageIndex  - Which message this snippet came from
 */

/**
 * @typedef {'extracted'|'partial'|'inaccessible'|'stub'} AttachmentStatus
 */

/**
 * @typedef {'pdf'|'docx'|'txt'|'csv'|'json'|'md'|'image'|'code'|'zip'|'other'} AttachmentType
 */

/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {string} name
 * @property {AttachmentType} type
 * @property {AttachmentStatus} status
 * @property {string} summary         - One-line description (safe to show in UI)
 * @property {string} [fullText]       - Extracted content (only present if status = 'extracted')
 * @property {Object} metadata        - Type-specific metadata (page count, dimensions, etc.)
 */

/**
 * @typedef {Object} AttachmentMeta
 * @property {string} id
 * @property {string} name
 * @property {AttachmentType} type
 * @property {AttachmentStatus} status
 * @property {string} summary
 * @property {Object} metadata
 * Note: fullText is NOT included in metadata (stored in body chunk)
 */

/**
 * @typedef {Object} MemoryBlock
 * @property {string} summary          - 2–4 sentence overview of the conversation
 * @property {string[]} goals          - Detected user goals
 * @property {string[]} decisions      - Decisions made during the conversation
 * @property {string[]} constraints    - Constraints identified (must/cannot/limit)
 * @property {string[]} openQuestions  - Unresolved questions
 * @property {string[]} entities       - Key entities: names, tools, frameworks, APIs
 */

/**
 * @typedef {Object} CaptureReport
 * @property {number} messagesFound      - Total message nodes discovered in DOM
 * @property {number} messagesCaptured   - Messages successfully extracted
 * @property {number} attachmentsFound   - Attachment nodes found
 * @property {number} attachmentsExtracted - Attachments with status 'extracted'
 * @property {number} completeness       - 0–100 percentage
 * @property {string[]} partial          - Attachment IDs with status 'partial'
 * @property {string[]} blocked          - Attachment IDs with status 'inaccessible'
 */

/**
 * @typedef {Object} SecurityMeta
 * @property {boolean} redacted         - Whether secrets were found and replaced
 * @property {boolean} encrypted        - Whether body is AES-GCM encrypted (always true in v2)
 * @property {'auto'|'passphrase'} encryptionMode
 */

/**
 * @typedef {Object} HydrationBlock
 * @property {string} continuationPrompt - The invisible natural-language continuation prompt
 */

/**
 * @typedef {Object} ConversationBody
 * @property {Message[]} messages
 * @property {string} compressed       - LZ/gzip compressed representation of messages (not stored, computed on save)
 */

/**
 * @typedef {Object} CodeBody
 * @property {CodeSnippet[]} snippets
 * @property {{ name: string, content: string, language: string }[]} files
 */

/**
 * @typedef {Object} CapsuleMetadata
 * Stored directly in the 'capsules' IndexedDB object store.
 * Does NOT contain conversation body or full attachment text.
 * @property {string} id                - UUID v4
 * @property {number} schemaVersion     - 1 = migrated from v1, 2 = native v2
 * @property {number} adapterVersion
 * @property {PlatformId} platform
 * @property {number} createdAt         - Unix ms timestamp
 * @property {string} title
 * @property {boolean} pinned
 * @property {CaptureLevel} captureLevel
 * @property {MemoryBlock} memory
 * @property {AttachmentMeta[]} attachmentsMeta
 * @property {CaptureReport} captureReport
 * @property {SecurityMeta} security
 * @property {HydrationBlock} hydration
 * @property {string|null} bodyRef      - ID of the first chunk in 'chunks' store
 * @property {number} bodyChunkCount
 */

/**
 * @typedef {Object} SynapseCapsule
 * Full capsule including decrypted/decompressed body. Never stored as-is.
 * @property {string} id
 * @property {number} schemaVersion
 * @property {number} adapterVersion
 * @property {PlatformId} platform
 * @property {number} createdAt
 * @property {string} title
 * @property {boolean} pinned
 * @property {CaptureLevel} captureLevel
 * @property {MemoryBlock} memory
 * @property {Attachment[]} attachments  - Full attachment objects including fullText
 * @property {CaptureReport} captureReport
 * @property {SecurityMeta} security
 * @property {HydrationBlock} hydration
 * @property {ConversationBody} conversation
 * @property {CodeBody} code
 */

/**
 * @typedef {Object} CapsuleBody
 * The data that gets compressed + encrypted and stored in chunks.
 * @property {{ messages: Message[] }} conversation
 * @property {{ id: string, fullText: string }[]} attachmentFullText
 * @property {CodeBody} code
 */

/**
 * @typedef {Object} SynapseExportFile
 * The .synapse file format (compressed + base64 encoded JSON)
 * @property {true} synapseExport       - Format marker
 * @property {number} schemaVersion
 * @property {string} appVersion
 * @property {number} exportedAt
 * @property {CaptureLevel} captureLevel
 * @property {SynapseCapsule} capsule
 */

/**
 * @typedef {Object} StorageUsage
 * @property {number} capsuleCount
 * @property {number} chunkCount
 * @property {number} totalBytes
 * @property {string} totalMB           - Formatted string e.g. "12.34"
 */

/**
 * @typedef {'fast'|'standard'|'deep'} DefaultCaptureLevel
 */

/**
 * @typedef {Object} SynapseSettings
 * @property {import('./crypto.js').JsonWebKey} encryptionKey
 * @property {'auto'|'passphrase'} encryptionMode
 * @property {DefaultCaptureLevel} captureLevel
 * @property {boolean} redactionEnabled
 * @property {string|null} activeCapsuleId
 * @property {number} schemaVersion
 * @property {string} appVersion
 * @property {number} installDate
 */

/**
 * @typedef {Object} WorkerResult
 * @property {string} id
 * @property {'ok'|'stub'|'error'} status
 * @property {*} [result]
 * @property {string} [message]
 * @property {string} [error]
 */

// Export nothing — this is a documentation-only module
export {};
