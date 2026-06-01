/**
 * Synapse v3 — IndexedDB Storage Layer
 *
 * Database:  synapse_v2  (version 1)
 * Stores:    capsules  — CapsuleMetadata objects (no body content)
 *            chunks    — Encrypted+compressed body split at 1MB boundaries
 *            settings  — Key-value configuration store
 *
 * CRITICAL:
 *   This module is imported ONLY by background.js (the service worker).
 *   All other contexts (dashboard, content script) interact with storage
 *   exclusively through chrome.runtime.sendMessage → background.js.
 *   This enforces single-writer semantics and prevents race conditions.
 *
 * Chunk strategy:
 *   Capsule body (conversation + attachment fullText + code) is:
 *     JSON.stringify → compress (offscreen) → encrypt (AES-GCM) → chunk at 1MB
 *   Most capsules produce a single chunk. Chunking kicks in for very long
 *   chats or sessions with many large attachments.
 */

const DB_NAME    = 'synapse_v2';
const DB_VERSION = 1;
const CHUNK_SIZE = 1024 * 1024; // 1MB per chunk

// Cached DB connection — reset on unexpected close
let _db = null;

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open (or upgrade) the IndexedDB database.
 * Creates all object stores and indexes on first use.
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Hard timeout to prevent IndexedDB deadlock in Chrome extensions
    const timer = setTimeout(() => {
      reject(new Error('IndexedDB open timed out after 5000ms. Chrome may have locked the database. Please restart Chrome or reload the extension.'));
    }, 5000);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── capsules store ─────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('capsules')) {
        const cs = db.createObjectStore('capsules', { keyPath: 'id' });
        cs.createIndex('idx_platform',  'platform',  { unique: false });
        cs.createIndex('idx_createdAt', 'createdAt', { unique: false });
        cs.createIndex('idx_pinned',    'pinned',    { unique: false });
      }

      // ── chunks store ───────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('chunks')) {
        const ck = db.createObjectStore('chunks', { keyPath: 'id' });
        ck.createIndex('idx_capsuleId', 'capsuleId', { unique: false });
        // Compound index for ordered chunk reassembly
        ck.createIndex('idx_order', ['capsuleId', 'sequence'], { unique: true });
      }

      // ── settings store ─────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`IDB open failed: ${req.error?.message}`));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('IDB upgrade blocked by another open tab. Close other tabs and retry.'));
    };
  });
}

/**
 * Get (or open) the singleton DB connection.
 * @returns {Promise<IDBDatabase>}
 */
let _dbPromise = null;

async function getDB() {
  if (_db) return _db;
  if (!_dbPromise) {
    _dbPromise = openDatabase().then(db => {
      _db = db;
      _db.onclose = () => { _db = null; _dbPromise = null; };
      _db.onversionchange = () => { _db.close(); _db = null; _dbPromise = null; };
      return db;
    }).catch(err => {
      _dbPromise = null;
      throw err;
    });
  }
  return _dbPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Promisify a single IDBRequest */
function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

/** Await a transaction's completion */
function idbTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('Transaction aborted'));
  });
}

/** Retrieve all records from an object store */
function getAllFromStore(store) {
  return idbReq(store.getAll());
}

/** Retrieve all records matching an index range */
function getAllFromIndex(index, range) {
  return idbReq(index.getAll(range));
}

/**
 * Split a Uint8Array into CHUNK_SIZE slices.
 * @param {Uint8Array} data
 * @returns {Uint8Array[]}
 */
function splitIntoChunks(data) {
  const chunks = [];
  for (let i = 0; i < data.byteLength; i += CHUNK_SIZE) {
    chunks.push(data.slice(i, i + CHUNK_SIZE));
  }
  return chunks.length > 0 ? chunks : [new Uint8Array(0)];
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPSULE CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save capsule metadata and its encrypted body to IndexedDB.
 *
 * @param {import('./types.js').CapsuleMetadata} metadata
 *   The capsule record to store in 'capsules'. Must NOT contain body fields.
 * @param {Uint8Array|null} encryptedBody
 *   Pre-encrypted (AES-GCM) and pre-compressed body bytes.
 *   Pass null for capsules with no content (e.g. migrated stubs).
 * @returns {Promise<void>}
 */
export async function saveCapsule(metadata, encryptedBody = null) {
  const db = await getDB();
  const tx = db.transaction(['capsules', 'chunks'], 'readwrite');
  const capsuleStore = tx.objectStore('capsules');
  const chunkStore   = tx.objectStore('chunks');

  const capsuleId = metadata.id;
  let bodyRef        = null;
  let bodyChunkCount = 0;

  if (encryptedBody && encryptedBody.byteLength > 0) {
    const slices = splitIntoChunks(encryptedBody);
    bodyChunkCount = slices.length;

    for (let i = 0; i < slices.length; i++) {
      const chunkId = `${capsuleId}:chunk:${i}`;
      if (i === 0) bodyRef = chunkId;

      chunkStore.put({
        id:          chunkId,
        capsuleId,
        sequence:    i,
        totalChunks: slices.length,
        data:        slices[i]
      });
    }
  }

  capsuleStore.put({ ...metadata, bodyRef, bodyChunkCount });

  await idbTx(tx);
}

/**
 * Retrieve capsule metadata only (no body decryption).
 * Fast — does not touch the chunks store.
 *
 * @param {string} id
 * @returns {Promise<import('./types.js').CapsuleMetadata|null>}
 */
export async function getCapsuleMetadata(id) {
  const db = await getDB();
  const tx = db.transaction('capsules', 'readonly');
  return idbReq(tx.objectStore('capsules').get(id));
}

/**
 * Retrieve the encrypted body for a capsule by reassembling all its chunks.
 * The caller is responsible for decryption and decompression.
 *
 * @param {string} id
 * @returns {Promise<Uint8Array|null>}
 */
export async function getCapsuleBody(id) {
  const metadata = await getCapsuleMetadata(id);
  if (!metadata || !metadata.bodyRef || metadata.bodyChunkCount === 0) return null;

  const db = await getDB();
  const tx = db.transaction('chunks', 'readonly');
  const idx = tx.objectStore('chunks').index('idx_capsuleId');

  const chunks = await getAllFromIndex(idx, IDBKeyRange.only(id));
  if (chunks.length === 0) return null;

  // Sort by sequence number for correct reassembly
  chunks.sort((a, b) => a.sequence - b.sequence);

  const totalBytes = chunks.reduce((sum, c) => sum + c.data.byteLength, 0);
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk.data), offset);
    offset += chunk.data.byteLength;
  }

  return result;
}

/**
 * List capsule metadata with pagination and sorting.
 * Never returns body data.
 *
 * @param {{ page?: number, pageSize?: number, sort?: 'createdAt'|'pinned'|'title', platformFilter?: string|null }} opts
 * @returns {Promise<{ capsules: import('./types.js').CapsuleMetadata[], total: number, page: number, pageSize: number }>}
 */
export async function listCapsules({
  page           = 0,
  pageSize       = 50,
  sort           = 'createdAt',
  platformFilter = null
} = {}) {
  const db = await getDB();
  const tx = db.transaction('capsules', 'readonly');
  let all  = await getAllFromStore(tx.objectStore('capsules'));

  if (platformFilter) {
    all = all.filter(c => c.platform === platformFilter);
  }

  // Sort
  switch (sort) {
    case 'pinned':
      all.sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
        b.createdAt - a.createdAt
      );
      break;
    case 'title':
      all.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      break;
    case 'createdAt':
    default:
      all.sort((a, b) => b.createdAt - a.createdAt);
  }

  const total = all.length;
  const start = page * pageSize;
  return { capsules: all.slice(start, start + pageSize), total, page, pageSize };
}

/**
 * Full-text search across title, memory summary, entities, and goals.
 * Case-insensitive substring matching (no external index needed).
 *
 * @param {string} query
 * @returns {Promise<{ capsules: import('./types.js').CapsuleMetadata[], total: number }>}
 */
export async function searchCapsules(query) {
  if (!query || !query.trim()) {
    return listCapsules({ pageSize: 50 });
  }

  const db  = await getDB();
  const tx  = db.transaction('capsules', 'readonly');
  const all = await getAllFromStore(tx.objectStore('capsules'));

  const q = query.toLowerCase().trim();

  const results = all.filter(c => {
    const searchableText = [
      c.title,
      c.platform,
      c.memory?.summary,
      ...(c.memory?.entities      || []),
      ...(c.memory?.goals         || []),
      ...(c.memory?.decisions     || []),
      ...(c.memory?.openQuestions || []),
      ...(c.attachmentsMeta || []).map(a => a.name),
    ].filter(Boolean).join(' ').toLowerCase();

    return searchableText.includes(q);
  });

  results.sort((a, b) => b.createdAt - a.createdAt);
  return { capsules: results, total: results.length, page: 0, pageSize: results.length };
}

/**
 * Delete a capsule and all its associated chunks.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteCapsule(id) {
  const db = await getDB();
  const tx = db.transaction(['capsules', 'chunks'], 'readwrite');

  // Delete all chunks belonging to this capsule
  const chunkIdx = tx.objectStore('chunks').index('idx_capsuleId');
  const chunks   = await getAllFromIndex(chunkIdx, IDBKeyRange.only(id));
  const chunkStore = tx.objectStore('chunks');
  for (const chunk of chunks) {
    chunkStore.delete(chunk.id);
  }

  tx.objectStore('capsules').delete(id);
  await idbTx(tx);
}

/**
 * Toggle the pinned state of a capsule.
 * @param {string} id
 * @param {boolean} pinned
 * @returns {Promise<void>}
 */
export async function pinCapsule(id, pinned) {
  const metadata = await getCapsuleMetadata(id);
  if (!metadata) throw new Error(`Capsule not found: ${id}`);

  const db = await getDB();
  const tx = db.transaction('capsules', 'readwrite');
  tx.objectStore('capsules').put({ ...metadata, pinned });
  await idbTx(tx);
}

/**
 * Erase ALL capsules and chunks.
 * Used by the Settings "Danger Zone" clear-all action.
 * @returns {Promise<void>}
 */
export async function clearAllCapsules() {
  const db = await getDB();
  const tx = db.transaction(['capsules', 'chunks'], 'readwrite');
  tx.objectStore('capsules').clear();
  tx.objectStore('chunks').clear();
  await idbTx(tx);
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a setting value by key.
 * Returns undefined if the key does not exist.
 * @param {string} key
 * @returns {Promise<*>}
 */
export async function getSetting(key) {
  const db     = await getDB();
  const tx     = db.transaction('settings', 'readonly');
  const record = await idbReq(tx.objectStore('settings').get(key));
  return record?.value;
}

/**
 * Write a setting value.
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await idbTx(tx);
}

/**
 * Batch-read multiple settings keys.
 * @param {string[]} keys
 * @returns {Promise<Record<string, *>>}
 */
export async function getSettings(keys) {
  const db  = await getDB();
  const tx  = db.transaction('settings', 'readonly');
  const map = {};

  await Promise.all(keys.map(async k => {
    const rec = await idbReq(tx.objectStore('settings').get(k));
    map[k]    = rec?.value;
  }));

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE USAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute aggregate storage usage.
 * @returns {Promise<import('./types.js').StorageUsage>}
 */
export async function getStorageUsage() {
  const db = await getDB();

  const capTx    = db.transaction('capsules', 'readonly');
  const allCaps  = await getAllFromStore(capTx.objectStore('capsules'));

  const chunkTx   = db.transaction('chunks', 'readonly');
  const allChunks = await getAllFromStore(chunkTx.objectStore('chunks'));

  const totalBytes = allChunks.reduce((sum, c) => {
    return sum + (c.data instanceof Uint8Array ? c.data.byteLength : 0);
  }, 0);

  return {
    capsuleCount: allCaps.length,
    chunkCount:   allChunks.length,
    totalBytes,
    totalMB:      (totalBytes / (1024 * 1024)).toFixed(2)
  };
}
