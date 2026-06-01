/**
 * Synapse v3 — Semantic Hasher
 *
 * Produces a deterministic 8-char hex hash for any text content.
 * Used for:
 *   - Message deduplication (avoid double-capturing retried messages)
 *   - Code block deduplication across messages
 *   - Edge uniqueness checks in the graph
 *
 * Runs entirely locally — no crypto API needed, just djb2.
 */

/**
 * djb2 hash — fast, deterministic, good distribution for short strings.
 * Returns an 8-char lowercase hex string.
 * @param {string} text
 * @returns {string}
 */
export function semanticHash(text) {
  if (!text || typeof text !== 'string') return '00000000';

  // Normalize: collapse whitespace, lowercase, strip zero-width chars
  const normalized = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width chars
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    // hash = hash * 33 ^ charCode
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    hash = hash >>> 0; // keep as unsigned 32-bit
  }

  return hash.toString(16).padStart(8, '0');
}

/**
 * Hash just the first N chars of content (for quick dedup of long messages).
 * @param {string} text
 * @param {number} [prefixLen=200]
 * @returns {string}
 */
export function prefixHash(text, prefixLen = 200) {
  return semanticHash((text || '').substring(0, prefixLen));
}

/**
 * Check if two messages are semantically duplicate.
 * Uses prefix hash — not full content — for performance.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isDuplicate(a, b) {
  if (!a || !b) return false;
  return prefixHash(a) === prefixHash(b);
}
