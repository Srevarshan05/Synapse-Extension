/**
 * Synapse v3 — Background Service Worker
 *
 * Responsibilities:
 *   1. Central message router for all extension contexts
 *   2. SOLE writer to IndexedDB (single-writer guarantee)
 *   3. Compression / decompression (inline using CompressionStream — no offscreen needed)
 *   4. Encryption/decryption of capsule bodies (AES-GCM via WebCrypto)
 *   5. v1 → v2 migration on extension update
 *
 * Message API:
 *   All messages arrive as { action: string, ...params }
 *   All responses returned as { success: boolean, ...data }
 *   Errors returned as { success: false, error: string }
 */

import * as store  from './core/storage.js';
import * as cypher from './core/crypto.js';

const APP_VERSION    = '3.0.0';
const SCHEMA_VERSION = 3;

// In-memory cache of the active CryptoKey — avoids re-importing JWK on every request.
// Cleared on service worker suspend (normal MV3 lifecycle).
let _activeKey = null;
const _emulatedJobs = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// INLINE COMPRESSION (no offscreen / web worker needed)
// CompressionStream is available in Chrome service workers since Chrome 80.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compress a string using gzip and return a base64-encoded result.
 * Runs entirely in the service worker — no offscreen document required.
 * @param {string} str
 * @returns {Promise<string>} base64 gzip
 */
async function compress(str) {
  const stream   = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const response = new Response(stream);
  const buffer   = await response.arrayBuffer();
  return bufferToBase64(buffer);
}

/**
 * Decompress a base64 gzip string back to the original string.
 * @param {string} b64
 * @returns {Promise<string>}
 */
async function decompress(b64) {
  const bytes    = base64ToBuffer(b64);
  const stream   = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const response = new Response(stream);
  const buffer   = await response.arrayBuffer();
  return new TextDecoder().decode(buffer);
}

/** ArrayBuffer → base64 string */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  let binary  = '';
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 string → Uint8Array */
function base64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Compress a JSON-serialisable value → base64 gzip string */
async function compressJSON(value) {
  return compress(JSON.stringify(value));
}

/** Decompress a base64 gzip string → parsed JS value */
async function decompressJSON(b64) {
  return JSON.parse(await decompress(b64));
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLATION / MIGRATION
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[Synapse v2] onInstalled — reason: ${details.reason}`);

  try {
    await initializeSettings();

    if (details.reason === 'update') {
      await migrateV1Capsules();
    }
  } catch (err) {
    console.error('[Synapse v2] Install handler error:', err);
  }
});

/**
 * Bootstrap required settings with safe defaults on first install or upgrade.
 * Never overwrites existing values — idempotent.
 */
async function initializeSettings() {
  // Auto-generate encryption key if absent
  const existingJWK = await store.getSetting('encryptionKey');
  if (!existingJWK) {
    const key = await cypher.generateKey();
    const jwk = await cypher.exportKeyToJWK(key);
    await store.setSetting('encryptionKey', jwk);
    _activeKey = key; // Cache immediately
    console.log('[Synapse v2] Auto-encryption key generated.');
  }

  // Set defaults (only if not already present)
  const defaults = {
    encryptionMode:   'auto',
    captureLevel:     'standard',
    redactionEnabled: true,
    activeCapsuleId:  null,
    'synapse-theme':  'dark',
    schemaVersion:    SCHEMA_VERSION,
    appVersion:       APP_VERSION,
    installDate:      Date.now()
  };

  for (const [key, value] of Object.entries(defaults)) {
    const existing = await store.getSetting(key);
    if (existing === undefined) {
      await store.setSetting(key, value);
    }
  }

  // Always update appVersion on install/update
  await store.setSetting('appVersion', APP_VERSION);
}

/**
 * Retrieve (and cache) the active AES-GCM CryptoKey.
 * @returns {Promise<CryptoKey>}
 */
async function getActiveKey() {
  if (_activeKey) return _activeKey;

  const jwk = await store.getSetting('encryptionKey');
  if (!jwk) throw new Error('No encryption key found. Extension may need to be reinstalled.');

  _activeKey = await cypher.importKeyFromJWK(jwk);
  return _activeKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB QUEUE — async save pipeline
// Popup submits a job and gets {jobId} back immediately.
// Background processes the job asynchronously and broadcasts completion.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Job states: queued → capturing (n/a here) → compressing → encrypting → saving → complete | failed
 * @type {Map<string, { state: string, tabId: number, jobId: string, startedAt: number, log: string[] }>}
 */
const _jobs = new Map();

function createJob(tabId) {
  const jobId = `bg-job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _jobs.set(jobId, { jobId, tabId, state: 'queued', startedAt: Date.now(), log: [] });
  return jobId;
}

function jobLog(jobId, msg) {
  const job = _jobs.get(jobId);
  if (job) { job.log.push(`${Date.now() - job.startedAt}ms: ${msg}`); }
  console.log(`[Synapse Job ${jobId}] ${msg}`);
}

function jobState(jobId, state) {
  const job = _jobs.get(jobId);
  if (job) job.state = state;
}

/**
 * Notify all extension contexts of a job state change.
 */
function notifyJob(jobId, payload) {
  try {
    chrome.runtime.sendMessage({ action: 'CAPSULE_JOB_UPDATE', jobId, ...payload });
  } catch { /* no listeners — that's fine */ }
}

/**
 * Process a save job asynchronously after popup returns.
 * Fetches staged capsule from content script, streams compress→encrypt→write.
 */
async function processSaveJob(jobId, tabId, contentJobId) {
  const t0 = Date.now();
  let capsuleId = null;

  try {
    // ── Step 1: Fetch staged capsule from content script incrementally ──
    jobState(jobId, 'fetching');
    jobLog(jobId, `Fetching staged capsule meta (contentJobId=${contentJobId}) from tab ${tabId}`);

    // A. Fetch capsule skeleton and counts
    const metaRes = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CAPSULE_FETCH_STAGED_META timed out (10s)')), 10_000);
      chrome.tabs.sendMessage(tabId, { action: 'CAPSULE_FETCH_STAGED_META', jobId: contentJobId }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res);
      });
    });

    if (!metaRes || metaRes.status !== 'ok' || !metaRes.meta) {
      throw new Error(metaRes?.error || 'Content script did not return staged metadata.');
    }

    const meta = metaRes.meta;
    capsuleId = meta.id;
    const { counts } = meta;

    jobLog(jobId, `Metadata fetched. Elements to fetch: ${counts.messages} messages, ${counts.nodes} nodes, ${counts.edges} edges, ${counts.attachments} attachments, ${counts.snippets} snippets`);

    // Helper to fetch partitions incrementally
    async function fetchPartInChunks(partName, totalCount, chunkSize = 100) {
      const allItems = [];
      for (let i = 0; i < totalCount; i += chunkSize) {
        const slice = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Fetch ${partName} slice [${i}] timed out`)), 8000);
          chrome.tabs.sendMessage(tabId, {
            action: 'CAPSULE_FETCH_STAGED_PART',
            jobId: contentJobId,
            part: partName,
            startIndex: i,
            count: chunkSize
          }, res => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!res || res.status !== 'ok') return reject(new Error(res?.error || `Failed to fetch slice for ${partName}`));
            resolve(res.slice || []);
          });
        });
        allItems.push(...slice);
        // Small yield pause to prevent IPC/main-thread locking
        await new Promise(r => setTimeout(r, 15));
      }
      return allItems;
    }

    // B. Fetch all arrays in safe batches
    const messages    = await fetchPartInChunks('messages', counts.messages, 100);
    const nodes       = await fetchPartInChunks('nodes', counts.nodes, 200);
    const edges       = await fetchPartInChunks('edges', counts.edges, 200);
    const attachments = await fetchPartInChunks('attachments', counts.attachments, 20);
    const snippets    = await fetchPartInChunks('snippets', counts.snippets, 50);

    // C. Reconstruct the capsule
    const capsule = {
      ...meta,
      conversation: { messages },
      graph: { nodes, edges, stats: meta.captureReport },
      attachments,
      code: { snippets }
    };

    // D. Clean up content script memory
    try {
      chrome.tabs.sendMessage(tabId, { action: 'CAPSULE_FETCH_STAGED_CLEANUP', jobId: contentJobId });
    } catch { /* cleanup errors can be safely ignored */ }

    const fetchMs = Date.now() - t0;
    jobLog(jobId, `Capsule fully fetched incrementally in ${fetchMs}ms — ${messages.length} messages`);

    // ── Step 2: Build body (what gets compressed + encrypted) ────────────
    jobState(jobId, 'compressing');
    notifyJob(jobId, { state: 'compressing', capsuleId });

    const t1 = Date.now();

    // Separate the heavy body from the light metadata
    const body = {
      conversation:      capsule.conversation || { messages: [] },
      graph:             capsule.graph        || null,   // semantic graph
      code:              capsule.code         || { snippets: [] },
      attachmentFullText: (capsule.attachments || []).map(a => ({
        id:       a.id,
        fullText: a.fullText || ''
      }))
    };

    // ── Step 3: Compress ─────────────────────────────────────────────────
    const compressed = await compress(JSON.stringify(body));
    const compressMs = Date.now() - t1;
    jobLog(jobId, `Compressed in ${compressMs}ms — ${compressed.length} chars`);

    // ── Step 4: Encrypt ──────────────────────────────────────────────────
    jobState(jobId, 'encrypting');
    notifyJob(jobId, { state: 'encrypting', capsuleId });

    const t2          = Date.now();
    const key         = await getActiveKey();
    const plainBytes  = base64ToBuffer(compressed);
    const encryptedBody = await cypher.encryptData(key, plainBytes);
    const encryptMs   = Date.now() - t2;
    jobLog(jobId, `Encrypted in ${encryptMs}ms — ${encryptedBody.byteLength} bytes`);

    // ── Step 5: Build metadata (light — no body fields) ──────────────────
    const metadata = buildMetadata(capsule);

    // ── Step 6: Write to IndexedDB (chunked, single writer) ───────────────
    jobState(jobId, 'saving');
    notifyJob(jobId, { state: 'saving', capsuleId });

    const t3 = Date.now();
    await store.saveCapsule(metadata, encryptedBody);
    const saveMs = Date.now() - t3;

    const totalMs = Date.now() - t0;
    jobLog(jobId, `Saved in ${saveMs}ms. Total: ${totalMs}ms`);

    // ── Step 7: Complete ─────────────────────────────────────────────────
    jobState(jobId, 'complete');
    notifyJob(jobId, {
      state:        'complete',
      capsuleId,
      title:        metadata.title,
      messageCount: metadata.captureReport?.messagesCaptured ?? 0,
      completeness: metadata.captureReport?.completeness     ?? 0,
      timing: { fetchMs, compressMs, encryptMs, saveMs, totalMs }
    });

    console.log(`[Synapse v2] Job ${jobId} complete — "${metadata.title}" (${capsuleId}) in ${totalMs}ms`);

  } catch (err) {
    jobState(jobId, 'failed');
    jobLog(jobId, `FAILED: ${err.message}`);
    console.error(`[Synapse v2] Job ${jobId} failed:`, err);
    notifyJob(jobId, { state: 'failed', capsuleId, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE ROUTER
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(data => {
      if (typeof sendResponse === 'function') {
        sendResponse({ success: true, ...data });
      }
    })
    .catch(err => {
      console.error(`[Synapse v2] Handler error [${message?.action}]:`, err.message);
      if (typeof sendResponse === 'function') {
        sendResponse({ success: false, error: err.message });
      }
    });

  return true; // Keep sendResponse channel open for async handlers
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

async function handleMessage(message, sender) {
  const { action } = message;

  switch (action) {

    // ── V3 Desktop Companion Loopback API ───────────────────────────────────

    case 'DESKTOP_STATUS': {
      try {
        const res = await fetch('http://127.0.0.1:3742/status');
        return await res.json();
      } catch {
        return { status: 'offline' };
      }
    }

    case 'DESKTOP_CAPTURE_START': {
      const res = await fetch('http://127.0.0.1:3742/capture/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      return await res.json();
    }

    case 'DESKTOP_CAPTURE_CHUNK': {
      const res = await fetch('http://127.0.0.1:3742/capture/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      return await res.json();
    }

    case 'DESKTOP_CAPSULE_BUILD': {
      const res = await fetch('http://127.0.0.1:3742/capsule/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      return await res.json();
    }

    case 'DESKTOP_CAPSULES_LIST': {
      const res = await fetch('http://127.0.0.1:3742/capsules');
      return await res.json();
    }

    case 'DESKTOP_HYDRATE': {
      const res = await fetch('http://127.0.0.1:3742/hydrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      });
      return await res.json();
    }

    case 'START_CAPTURE_FLOW': {
      const { tabId, captureLevel, platform } = message;
      if (!tabId) throw new Error('START_CAPTURE_FLOW: missing tabId');

      const jobId = createJob(tabId);
      jobLog(jobId, `Full capture flow started — tabId=${tabId}, platform=${platform}, level=${captureLevel}`);

      // Fire-and-forget — background handles everything, popup gets jobId back immediately
      processFullCaptureFlow(jobId, tabId, captureLevel, platform).catch(err =>
        console.error(`[Synapse v3] processFullCaptureFlow unhandled:`, err)
      );

      return { jobId };
    }

    case 'DESKTOP_CAPTURE_JOB': {
      const { tabId, contentJobId, captureLevel, platform } = message;
      if (!tabId)         throw new Error('DESKTOP_CAPTURE_JOB: missing tabId');
      if (!contentJobId) throw new Error('DESKTOP_CAPTURE_JOB: missing contentJobId');

      const jobId = createJob(tabId);
      jobLog(jobId, `Desktop save job created — contentJobId=${contentJobId}, tabId=${tabId}, platform=${platform}`);

      // Fire-and-forget — popup gets jobId back immediately
      processDesktopSaveJob(jobId, tabId, contentJobId, captureLevel, platform).catch(err =>
        console.error(`[Synapse v3] processDesktopSaveJob unhandled:`, err)
      );

      return { jobId };
    }

    case 'SYNAPSE_FETCH_IMAGE': {
      const { url } = message;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          try {
            reader.readAsDataURL(blob);
          } catch (e) {
            reject(e);
          }
        });
        return { success: true, dataUrl };
      } catch (err) {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const buffer = await blob.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buffer);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          const dataUrl = `data:${blob.type};base64,${base64}`;
          return { success: true, dataUrl };
        } catch (err2) {
          console.error('[Synapse Background] Failed to fetch image:', url, err2);
          return { success: false, error: err2.message };
        }
      }
    }

    case 'SYNAPSE_CAPTURE_SCREENSHOT': {
      return new Promise((resolve, reject) => {
        const windowId = sender?.tab?.windowId || null;
        chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            console.warn('[Synapse Background] captureVisibleTab with windowId failed:', chrome.runtime.lastError.message);
            // Fallback to active window
            chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 80 }, (dataUrlFallback) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve({ success: true, dataUrl: dataUrlFallback });
              }
            });
          } else {
            resolve({ success: true, dataUrl });
          }
        });
      });
    }

    // ── Capsule list / search ───────────────────────────────────────────────

    case 'CAPSULE_LIST': {
      return store.listCapsules({
        page:           message.page     ?? 0,
        pageSize:       message.pageSize ?? 50,
        sort:           message.sort     ?? 'createdAt',
        platformFilter: message.platform ?? null
      });
    }

    case 'CAPSULE_SEARCH': {
      return store.searchCapsules(message.query || '');
    }

    // ── Capsule read (full decrypt+decompress) ──────────────────────────────

    case 'CAPSULE_GET': {
      const meta = await store.getCapsuleMetadata(message.id);
      if (!meta) return { capsule: null };

      const encBody = await store.getCapsuleBody(message.id);
      if (!encBody) {
        return {
          capsule: {
            ...meta,
            conversation: { messages: [] },
            attachments:  [],
            code:         { snippets: [], files: [] }
          }
        };
      }

      const key       = await getActiveKey();
      const decrypted = await cypher.decryptData(key, encBody);
      const b64       = cypher.uint8ToBase64(decrypted);
      const body      = await decompressJSON(b64);

      const capsule = {
        ...meta,
        conversation: body.conversation || { messages: [] },
        attachments:  mergeAttachments(meta.attachmentsMeta, body.attachmentFullText),
        code:         body.code || { snippets: [], files: [] }
      };

      return { capsule };
    }

    // ── Capsule save — Job Queue pattern ────────────────────────────────────
    // Popup sends { action: CAPSULE_SAVE_JOB, tabId, contentJobId }.
    // Background returns { jobId } IMMEDIATELY (no waiting for compress/encrypt/write).
    // Processing happens async in processSaveJob().
    // Popup listens for CAPSULE_JOB_UPDATE broadcast to know when complete.

    case 'CAPSULE_SAVE_JOB': {
      const { tabId, contentJobId } = message;
      if (!tabId)         throw new Error('CAPSULE_SAVE_JOB: missing tabId');
      if (!contentJobId) throw new Error('CAPSULE_SAVE_JOB: missing contentJobId');

      const jobId = createJob(tabId);
      jobLog(jobId, `Save job created — contentJobId=${contentJobId}, tabId=${tabId}`);

      // Fire-and-forget — popup gets jobId back immediately
      processSaveJob(jobId, tabId, contentJobId).catch(err =>
        console.error(`[Synapse v2] processSaveJob unhandled:`, err)
      );

      return { jobId };
    }

    // ── Legacy CAPSULE_SAVE (kept for backward compat, e.g. import flow) ───
    case 'CAPSULE_SAVE': {
      const { capsule } = message;
      if (!capsule)    throw new Error('No capsule data provided.');
      if (!capsule.id) throw new Error('Capsule is missing required "id" field.');

      const body = {
        conversation:      capsule.conversation || { messages: [] },
        graph:             capsule.graph        || null,
        code:              capsule.code         || { snippets: [] },
        attachmentFullText: (capsule.attachments || []).map(a => ({ id: a.id, fullText: a.fullText || '' }))
      };

      const compressed   = await compress(JSON.stringify(body));
      const key          = await getActiveKey();
      const plainBytes   = base64ToBuffer(compressed);
      const encryptedBody = await cypher.encryptData(key, plainBytes);
      const metadata     = buildMetadata(capsule);
      await store.saveCapsule(metadata, encryptedBody);

      console.log(`[Synapse v2] Capsule saved (legacy): "${metadata.title}" (${metadata.id})`);
      return { capsuleId: metadata.id };
    }

    // ── Job status query ────────────────────────────────────────────────────
    case 'JOB_STATUS': {
      const job = _jobs.get(message.jobId);
      if (!job) return { state: 'unknown' };
      return { state: job.state, log: job.log, jobId: job.jobId };
    }

    // ── Capsule delete ──────────────────────────────────────────────────────

    case 'CAPSULE_DELETE': {
      await store.deleteCapsule(message.id);
      return {};
    }

    // ── Capsule pin ─────────────────────────────────────────────────────────

    case 'CAPSULE_PIN': {
      await store.pinCapsule(message.id, message.pinned);
      return {};
    }

    // ── Export (.synapse file) ──────────────────────────────────────────────

    case 'CAPSULE_EXPORT': {
      const fullResult = await handleMessage({ action: 'CAPSULE_GET', id: message.id }, sender);
      if (!fullResult.capsule) throw new Error('Capsule not found');

      const exportObj = {
        synapseExport: true,
        schemaVersion: SCHEMA_VERSION,
        appVersion:    APP_VERSION,
        exportedAt:    Date.now(),
        captureLevel:  fullResult.capsule.captureLevel || 'standard',
        capsule:       fullResult.capsule
      };

      const compressed = await compressJSON(exportObj);
      return { data: compressed };
    }

    // ── Import (.synapse file) ──────────────────────────────────────────────

    case 'CAPSULE_IMPORT': {
      const { data } = message;
      if (!data) throw new Error('No import data provided');

      let exportObj;
      try {
        exportObj = await decompressJSON(data);
      } catch {
        throw new Error('Invalid .synapse file — could not decompress. File may be corrupted.');
      }

      if (!exportObj?.synapseExport) {
        throw new Error('Invalid .synapse file — missing format marker.');
      }

      const imported = exportObj.capsule;
      const newId    = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const importedCapsule = { ...imported, id: newId };

      const body = {
        conversation:       importedCapsule.conversation || { messages: [] },
        attachmentFullText: (importedCapsule.attachments || []).map(a => ({
          id: a.id, fullText: a.fullText || ''
        })),
        code: importedCapsule.code || { snippets: [], files: [] }
      };

      const compressed = await compressJSON(body);
      const key        = await getActiveKey();
      const plainBytes = base64ToBuffer(compressed);
      const encBody    = await cypher.encryptData(key, plainBytes);

      const metadata = buildMetadata(importedCapsule);
      await store.saveCapsule(metadata, encBody);

      return { capsule: metadata };
    }

    // ── Clear all (danger zone) ─────────────────────────────────────────────

    case 'CLEAR_ALL_CAPSULES': {
      await store.clearAllCapsules();
      return {};
    }

    // ── Settings ────────────────────────────────────────────────────────────

    case 'SETTING_GET': {
      const value = await store.getSetting(message.key);
      return { value };
    }

    case 'SETTING_SET': {
      await store.setSetting(message.key, message.value);
      if (message.key === 'encryptionKey') _activeKey = null;
      return {};
    }

    case 'CAPTURE_PROGRESS': {
      return {}; // Handled directly in popup via broadcast
    }

    // ── Storage usage ───────────────────────────────────────────────────────

    case 'STORAGE_USAGE': {
      return store.getStorageUsage();
    }

    // ── Active capsule ──────────────────────────────────────────────────────

    case 'GET_ACTIVE_CAPSULE': {
      const activeCapsuleId = await store.getSetting('activeCapsuleId');
      if (!activeCapsuleId) return { capsule: null };
      return handleMessage({ action: 'CAPSULE_GET', id: activeCapsuleId }, sender);
    }

    case 'SET_ACTIVE_CAPSULE': {
      await store.setSetting('activeCapsuleId', message.id);
      return {};
    }

    case 'CLEAR_ACTIVE_CAPSULE': {
      await store.setSetting('activeCapsuleId', null);
      return {};
    }

    // ── Inject (hydrate) a capsule into an open platform tab ───────────────

    case 'CAPSULE_INJECT': {
      const { capsuleId, mode = 'silent', targetPlatform } = message;
      if (!capsuleId) throw new Error('No capsuleId provided for injection.');

      // 1. Get the full decrypted capsule
      const fullResult = await handleMessage({ action: 'CAPSULE_GET', id: capsuleId }, sender);
      if (!fullResult.capsule) throw new Error('Capsule not found.');
      const capsule = fullResult.capsule;

      const platform = targetPlatform || capsule.platform;

      // Platform → URL map
      const PLATFORM_URLS = {
        chatgpt:    'https://chatgpt.com/',
        claude:     'https://claude.ai/',
        gemini:     'https://gemini.google.com/',
        deepseek:   'https://chat.deepseek.com/',
        kimi:       'https://kimi.moonshot.cn/',
        grok:       'https://grok.com/',
        copilot:    'https://copilot.microsoft.com/',
        perplexity: 'https://www.perplexity.ai/',
        poe:        'https://poe.com/',
        openrouter: 'https://openrouter.ai/',
        mistral:    'https://chat.mistral.ai/',
        qwen:       'https://chat.qwen.ai/'
      };

      const PLATFORM_DOMAINS = {
        chatgpt:    'chatgpt.com',
        claude:     'claude.ai',
        gemini:     'gemini.google.com',
        deepseek:   'chat.deepseek.com',
        kimi:       'kimi.moonshot.cn',
        grok:       'grok.com',
        copilot:    'copilot.microsoft.com',
        perplexity: 'perplexity.ai',
        poe:        'poe.com',
        openrouter: 'openrouter.ai',
        mistral:    'chat.mistral.ai',
        qwen:       'chat.qwen.ai'
      };

      const targetDomain = PLATFORM_DOMAINS[platform];
      const targetUrl    = PLATFORM_URLS[platform];

      if (!targetUrl) throw new Error(`Unknown platform: "${platform}"`);

      // 2. Find an existing tab for this platform
      let targetTab = null;
      const allTabs = await chrome.tabs.query({});
      for (const tab of allTabs) {
        try {
          const url = new URL(tab.url || '');
          if (url.hostname.includes(targetDomain)) {
            targetTab = tab;
            break;
          }
        } catch { /* skip malformed URLs */ }
      }

      // 3. If no tab found, open a new one and wait for it to load
      if (!targetTab) {
        targetTab = await chrome.tabs.create({ url: targetUrl, active: true });
        // Wait for page to load (max 15s)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Platform tab took too long to load.')), 15000);
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === targetTab.id && info.status === 'complete') {
              clearTimeout(timer);
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });
        // Extra wait for JS frameworks to render
        await new Promise(r => setTimeout(r, 2000));
      } else {
        // Bring existing tab to front
        await chrome.tabs.update(targetTab.id, { active: true });
        const tabWindow = await chrome.windows.get(targetTab.windowId);
        if (!tabWindow.focused) await chrome.windows.update(targetTab.windowId, { focused: true });
        // Small wait for page to be ready
        await new Promise(r => setTimeout(r, 500));
      }

      // 4. Inject content script if not already running
      const pingResponse = await new Promise(resolve => {
        chrome.tabs.sendMessage(targetTab.id, { action: 'PING' }, res => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      });

      if (!pingResponse?.alive) {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files:  ['content.bundle.js']
        });
        await new Promise(r => setTimeout(r, 800));
      }

      // 5. Send HYDRATE_START to the content script
      const hydrateResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Hydration timed out. The platform page may still be loading — please try again.')),
          20000
        );
        chrome.tabs.sendMessage(
          targetTab.id,
          { action: 'HYDRATE_START', capsuleId, mode },
          res => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
          }
        );
      });

      return { injected: true, tabId: targetTab.id, report: hydrateResult };
    }

    // ── Content script ping ─────────────────────────────────────────────────


    case 'PING': {
      return { alive: true, version: APP_VERSION };
    }

    // ── Attachment extraction (stub — Phase 4) ──────────────────────────────

    case 'EXTRACT_ATTACHMENT': {
      const { type, name, dataArray } = message;
      if (!dataArray) throw new Error('No dataArray provided');

      // Fast extraction for plain text types
      if (['txt', 'csv', 'json', 'md'].includes(type)) {
        const buffer  = new Uint8Array(dataArray).buffer;
        const text    = new TextDecoder().decode(buffer);
        const truncated = text.length > 500000
          ? text.substring(0, 500000) + '\n\n[...Truncated...]'
          : text;
        return { status: 'extracted', text: truncated };
      }

      // Non-text types: acknowledge but skip (Phase 4 will add PDF/OCR workers)
      return { status: 'inaccessible', text: '' };
    }

    default:
      throw new Error(`Unknown action: "${action}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a CapsuleMetadata record from a full SynapseCapsule.
 * Strips body fields (conversation, attachments.fullText, code).
 */
function buildMetadata(capsule) {
  return {
    id:             capsule.id,
    schemaVersion:  capsule.schemaVersion  ?? 3,
    adapterVersion: capsule.adapterVersion ?? 1,
    platform:       capsule.platform       ?? 'unknown',
    createdAt:      capsule.createdAt      ?? Date.now(),
    title:          capsule.title          || 'Untitled Capture',
    pinned:         capsule.pinned         ?? false,
    captureLevel:   capsule.captureLevel   ?? 'standard',

    memory: {
      summary:       capsule.memory?.summary       ?? '',
      goals:         capsule.memory?.goals         ?? [],
      decisions:     capsule.memory?.decisions     ?? [],
      constraints:   capsule.memory?.constraints   ?? [],
      openQuestions: capsule.memory?.openQuestions ?? [],
      entities:      capsule.memory?.entities      ?? [],
      // continuation is stored in body, not metadata (too large)
    },

    attachmentsMeta: (capsule.attachments || []).map(a => ({
      id:       a.id,
      name:     a.name,
      type:     a.type,
      status:   a.status,
      summary:  a.summary  ?? '',
      metadata: a.metadata ?? {}
    })),

    captureReport: {
      messagesFound:        capsule.captureReport?.messagesFound        ?? 0,
      messagesCaptured:     capsule.captureReport?.messagesCaptured     ?? 0,
      messagesDeduped:      capsule.captureReport?.messagesDeduped      ?? 0,
      attachmentsFound:     capsule.captureReport?.attachmentsFound     ?? 0,
      attachmentsExtracted: capsule.captureReport?.attachmentsExtracted ?? 0,
      codeSnippets:         capsule.captureReport?.codeSnippets         ?? 0,
      completeness:         capsule.captureReport?.completeness         ?? 0,
      graphNodes:           capsule.captureReport?.graphNodes           ?? 0,
      graphEdges:           capsule.captureReport?.graphEdges           ?? 0,
      partial:              capsule.captureReport?.partial              ?? [],
      blocked:              capsule.captureReport?.blocked              ?? []
    },

    security: {
      redacted:       capsule.security?.redacted       ?? false,
      encrypted:      true,
      encryptionMode: capsule.security?.encryptionMode ?? 'auto'
    },

    hydration: {
      continuationPrompt: capsule.hydration?.continuationPrompt ?? ''
    }
  };
}

function mergeAttachments(metas = [], fullTexts = []) {
  const ftMap = Object.fromEntries(fullTexts.map(ft => [ft.id, ft.fullText]));
  return metas.map(m => ({ ...m, fullText: ftMap[m.id] || undefined }));
}

async function processDesktopSaveJob(jobId, tabId, contentJobId, captureLevel, platform) {
  const t0 = Date.now();
  let capsuleId = null;

  try {
    // ── Step 1: Fetch staged metadata from content script ──
    jobState(jobId, 'fetching');
    jobLog(jobId, `Fetching staged capsule meta (contentJobId=${contentJobId}) from tab ${tabId}`);
    notifyJob(jobId, { state: 'discovering', platform });

    // A. Fetch capsule skeleton and counts
    const metaRes = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CAPSULE_FETCH_STAGED_META timed out (10s)')), 10_000);
      chrome.tabs.sendMessage(tabId, { action: 'CAPSULE_FETCH_STAGED_META', jobId: contentJobId }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res);
      });
    });

    if (!metaRes || metaRes.status !== 'ok' || !metaRes.meta) {
      throw new Error(metaRes?.error || 'Content script did not return staged metadata.');
    }

    const meta = metaRes.meta;
    const { counts } = meta;
    const title = meta.title || 'Untitled Chat';

    jobLog(jobId, `Metadata fetched. Elements to fetch: ${counts.messages} messages, ${counts.nodes} nodes, ${counts.edges} edges`);
    notifyJob(jobId, { state: 'loading', platform, title, messagesVisible: counts.messages });

    // ── Step 2: Initialize Tauri Desktop job ──
    // Count all data parts to properly estimate total chunks
    const CHUNK_SIZE = 50; // raw items per chunk (smaller for raw payloads)
    const msgChunks   = Math.ceil((counts.messages || 0) / CHUNK_SIZE);
    const nodeChunks  = Math.ceil((counts.nodes    || 0) / CHUNK_SIZE);
    const edgeChunks  = Math.ceil((counts.edges    || 0) / CHUNK_SIZE);
    const totalChunksExpected = Math.max(msgChunks + nodeChunks + edgeChunks, 1);
    
    const startPayload = {
      platform: platform || 'unknown',
      title: title || 'Untitled Chat',
      capture_level: captureLevel || 'standard',
      total_chunks_expected: totalChunksExpected || 0
    };
    jobLog(jobId, `Initializing Tauri capture job with payload: ${JSON.stringify(startPayload)}`);

    const startRes = await fetch('http://127.0.0.1:3742/capture/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(startPayload)
    });

    if (!startRes.ok) {
      const errText = await startRes.text();
      throw new Error(`Companion server rejected capture start (status ${startRes.status}): ${errText}`);
    }

    const startObj = await startRes.json();
    if (!startObj || !startObj.success) {
      throw new Error(startObj?.error || 'Failed to start capture job on Synapse Desktop.');
    }

    const desktopJobId = startObj.job_id;

    // Helper to pull chunks from content script and push directly to Desktop loopback.
    // Items are sent RAW — no field-stripping, no transformation whatsoever.
    async function streamPartInChunks(partName, totalCount, chunkSize) {
      if (!totalCount || totalCount === 0) return; // nothing to stream for this part
      for (let i = 0; i < totalCount; i += chunkSize) {
        const sliceRes = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Fetch ${partName} slice [${i}] timed out`)), 8000);
          chrome.tabs.sendMessage(tabId, {
            action: 'CAPSULE_FETCH_STAGED_PART',
            jobId: contentJobId,
            part: partName,
            startIndex: i,
            count: chunkSize
          }, res => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });

        if (!sliceRes || sliceRes.status !== 'ok') {
          throw new Error(sliceRes?.error || `Failed to retrieve chunk for ${partName}`);
        }

        // Send raw slice directly to companion server — zero transformation
        const rawSlice = sliceRes.slice || [];
        const chunkPayload = {
          job_id: desktopJobId,
          chunk_index: i / chunkSize,
          data: rawSlice          // ← raw DOM items, exactly as extracted
        };

        let retries = 3;
        let delay = 500;
        let streamRes;

        while (retries >= 0) {
          try {
            streamRes = await fetch('http://127.0.0.1:3742/capture/chunk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(chunkPayload)
            });

            if (streamRes.ok) break;

            const errText = await streamRes.text();
            throw new Error(`Companion server rejected chunk ${i} (status ${streamRes.status}): ${errText}`);
          } catch (err) {
            if (retries === 0) {
              throw err;
            }
            console.warn(`[Synapse v3] Chunk stream error, retrying in ${delay}ms... (Retries left: ${retries})`, err);
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
            retries--;
          }
        }

        const streamObj = await streamRes.json();
        if (!streamObj || !streamObj.success) {
          throw new Error(streamObj?.error || `Failed to stream chunk to Desktop for ${partName}`);
        }

        notifyJob(jobId, {
          state: 'streaming',
          part: partName,
          progress: Math.min(i + chunkSize, totalCount),
          total: totalCount
        });
        await new Promise(r => setTimeout(r, 15)); // yield pause between chunks
      }
    }

    // Stream ALL parts raw — messages, graph nodes, and graph edges
    jobLog(jobId, `Streaming ${counts.messages} messages raw...`);
    await streamPartInChunks('messages', counts.messages, CHUNK_SIZE);
    jobLog(jobId, `Streaming ${counts.nodes} nodes raw...`);
    await streamPartInChunks('nodes',    counts.nodes,    CHUNK_SIZE);
    jobLog(jobId, `Streaming ${counts.edges} edges raw...`);
    await streamPartInChunks('edges',    counts.edges,    CHUNK_SIZE);

    const totalRawItems = (counts.messages || 0) + (counts.nodes || 0) + (counts.edges || 0);
    jobLog(jobId, `Streaming complete — ${totalRawItems} total raw items sent to companion.`);

    // ── Step 3: Build & Save capsule on Tauri companion ──
    notifyJob(jobId, { state: 'building', title });
    const completeness = meta.captureReport?.completeness ?? 100;
    
    const buildPayload = {
      job_id: desktopJobId,
      completeness: completeness
    };

    const buildRes = await fetch('http://127.0.0.1:3742/capsule/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload)
    });

    if (!buildRes.ok) {
      const errText = await buildRes.text();
      throw new Error(`Companion server rejected capsule build (status ${buildRes.status}): ${errText}`);
    }

    const buildObj = await buildRes.json();
    if (!buildObj || !buildObj.success) {
      throw new Error(buildObj?.error || 'Failed to persist capsule in Synapse Desktop.');
    }

    capsuleId = buildObj.capsule_id;
    const totalMs = Date.now() - t0;
    const rawItemCount = (buildObj.stats?.raw_items ?? totalRawItems);
    jobLog(jobId, `Desktop job completed successfully in ${totalMs}ms — capsuleId: ${capsuleId}, raw items preserved: ${rawItemCount}`);

    // D. Clean up content script memory
    try {
      chrome.tabs.sendMessage(tabId, { action: 'CAPSULE_FETCH_STAGED_CLEANUP', jobId: contentJobId });
    } catch { /* cleanup errors can be safely ignored */ }

    // ── Step 4: Complete ──
    jobState(jobId, 'complete');
    notifyJob(jobId, {
      state: 'complete',
      capsuleId,
      title,
      messageCount: buildObj.stats?.messages ?? counts.messages,
      rawItemCount,
      completeness,
      timing: { totalMs }
    });

  } catch (err) {
    jobState(jobId, 'failed');
    jobLog(jobId, `FAILED: ${err.message}`);
    notifyJob(jobId, { state: 'failed', error: err.message });
  }
}

async function processFullCaptureFlow(jobId, tabId, captureLevel, platform) {
  try {
    jobState(jobId, 'discovering');
    notifyJob(jobId, { state: 'discovering', platform });

    // Step 1: Send CAPTURE_START to content script in the tab
    jobLog(jobId, `Sending CAPTURE_START to tab ${tabId}`);
    const captureRes = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CAPTURE_START on tab timed out (90s)')), 90_000);
      chrome.tabs.sendMessage(tabId, { action: 'CAPTURE_START', level: captureLevel }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res);
      });
    });

    if (!captureRes || captureRes.status === 'error') {
      throw new Error(captureRes?.error || 'Capture on tab failed.');
    }

    const { jobId: contentJobId } = captureRes;
    jobLog(jobId, `Tab capture staging complete — contentJobId=${contentJobId}`);

    // Step 2: Stream content to Desktop SQLite vault
    await processDesktopSaveJob(jobId, tabId, contentJobId, captureLevel, platform);

  } catch (err) {
    jobState(jobId, 'failed');
    jobLog(jobId, `FAILED: ${err.message}`);
    notifyJob(jobId, { state: 'failed', error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 → V2 MIGRATION
// ─────────────────────────────────────────────────────────────────────────────

async function migrateV1Capsules() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ capsules: [] }, async (data) => {
      const v1Capsules = data.capsules;
      if (v1Capsules.length === 0) { resolve(); return; }

      console.log(`[Synapse v2] Migrating ${v1Capsules.length} v1 capsule(s) to v2 format...`);

      for (const v1 of v1Capsules) {
        try {
          const v2Metadata = convertV1ToV2Metadata(v1);

          const body = {
            conversation: {
              messages: v1.fullContent
                ? [{ id: 'migrated-0', role: 'assistant', content: v1.fullContent }]
                : []
            },
            attachmentFullText: [],
            code: v1.codeSkeleton
              ? { snippets: [{ language: 'unknown', content: v1.codeSkeleton }], files: [] }
              : { snippets: [], files: [] }
          };

          const compressed  = await compressJSON(body);
          const key         = await getActiveKey();
          const plainBytes  = base64ToBuffer(compressed);
          const encBody     = await cypher.encryptData(key, plainBytes);

          await store.saveCapsule(v2Metadata, encBody);
          console.log(`[Synapse v2]  ✓ Migrated: "${v1.topic}"`);
        } catch (err) {
          console.warn(`[Synapse v2]  ✗ Migration failed for "${v1.topic || v1.id}":`, err.message);
        }
      }

      chrome.storage.local.remove('capsules', () => {
        console.log('[Synapse v2] Migration complete. v1 data removed from chrome.storage.local.');
        resolve();
      });
    });
  });
}

function convertV1ToV2Metadata(v1) {
  return {
    id:             v1.id || `migrated-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    schemaVersion:  1,
    adapterVersion: 0,
    platform:       'unknown',
    createdAt:      v1.timestamp || Date.now(),
    title:          v1.topic    || 'Migrated Capsule',
    pinned:         false,
    captureLevel:   'fast',
    memory: {
      summary:       v1.summary || '',
      goals:         [],
      decisions:     [],
      constraints:   [],
      openQuestions: [],
      entities:      []
    },
    attachmentsMeta: [],
    captureReport: {
      messagesFound: 1, messagesCaptured: 1,
      attachmentsFound: 0, attachmentsExtracted: 0,
      completeness: 50, partial: [], blocked: []
    },
    security: { redacted: false, encrypted: true, encryptionMode: 'auto' },
    hydration: { continuationPrompt: '' }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE WORKER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onSuspend.addListener(() => {
  _activeKey = null; // Clear in-memory key cache — reloaded on next activation
});
