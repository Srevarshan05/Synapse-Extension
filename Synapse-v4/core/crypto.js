/**
 * Synapse v3 — WebCrypto AES-GCM Layer
 * All encryption/decryption for capsule bodies.
 *
 * Algorithm: AES-GCM 256-bit
 * Key derivation: PBKDF2 (passphrase mode) or random (auto mode)
 * IV: 96-bit random, prepended to every ciphertext
 *
 * IMPORTANT: This module runs in the background service worker context only.
 * Never call crypto.subtle in content scripts — all encrypt/decrypt goes
 * through background.js via chrome.runtime.sendMessage.
 */

const ALGO        = 'AES-GCM';
const KEY_BITS    = 256;
const IV_BYTES    = 12;   // 96-bit IV — GCM standard
const SALT_BYTES  = 16;
const PBKDF2_ITER = 100_000;
const PBKDF2_HASH = 'SHA-256';

// ─────────────────────────────────────────────────────────────────────────────
// KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a new random AES-GCM-256 key.
 * Used for auto-key mode (default).
 * @returns {Promise<CryptoKey>}
 */
export async function generateKey() {
  return crypto.subtle.generateKey(
    { name: ALGO, length: KEY_BITS },
    true,                    // extractable — needed to export+store in IndexedDB
    ['encrypt', 'decrypt']
  );
}

/**
 * Derive a deterministic AES-GCM key from a user passphrase.
 * @param {string} passphrase
 * @param {Uint8Array} salt  - 16-byte random salt (stored alongside encrypted data)
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKeyFromPassphrase(passphrase, salt) {
  const enc = new TextEncoder();

  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: PBKDF2_HASH },
    baseKey,
    { name: ALGO, length: KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a cryptographically random salt for passphrase derivation.
 * @returns {Uint8Array}
 */
export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

// ─────────────────────────────────────────────────────────────────────────────
// KEY SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export a CryptoKey to JWK format for IndexedDB storage.
 * @param {CryptoKey} key
 * @returns {Promise<JsonWebKey>}
 */
export async function exportKeyToJWK(key) {
  return crypto.subtle.exportKey('jwk', key);
}

/**
 * Import a JWK back to a usable CryptoKey.
 * @param {JsonWebKey} jwk
 * @returns {Promise<CryptoKey>}
 */
export async function importKeyFromJWK(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: ALGO, length: KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCRYPT / DECRYPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a Uint8Array with AES-GCM.
 * Output format: [12-byte IV][ciphertext]
 *
 * @param {CryptoKey} key
 * @param {Uint8Array} plaintext
 * @returns {Promise<Uint8Array>} IV-prepended ciphertext
 */
export async function encryptData(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    plaintext
  );

  // Prepend IV so decrypt knows where the IV ends
  const out = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), IV_BYTES);
  return out;
}

/**
 * Decrypt an IV-prepended AES-GCM ciphertext.
 *
 * @param {CryptoKey} key
 * @param {Uint8Array} data  - [12-byte IV][ciphertext]
 * @returns {Promise<Uint8Array>} plaintext
 */
export async function decryptData(key, data) {
  const iv         = data.slice(0, IV_BYTES);
  const ciphertext = data.slice(IV_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE64 UTILITIES
// Used to bridge between Uint8Array (storage/crypto) and string (compression worker)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode Uint8Array to base64 string.
 * Chunked to avoid call stack overflow on large buffers.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/**
 * Decode base64 string to Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
