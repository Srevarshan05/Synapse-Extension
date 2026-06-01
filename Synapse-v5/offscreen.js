/**
 * Synapse v2 — Offscreen Worker Relay
 *
 * This document hosts all Web Workers for Synapse.
 * It acts as a relay: messages arrive from background.js via chrome.runtime,
 * get forwarded to the appropriate worker, and the result is sent back to
 * background via chrome.runtime.sendMessage({ target: 'background', ... }).
 *
 * Worker registry:
 *   compression  → workers/compression.worker.js  (gzip, always ready)
 *   pdf          → workers/pdf.worker.js           (Phase 4 stub)
 *   ocr          → workers/ocr.worker.js           (Phase 4 stub)
 *   attachment   → workers/attachment.worker.js    (Phase 4 stub)
 *
 * Worker instances are created lazily on first use and kept alive.
 * A failed worker is removed from the pool and recreated on next request.
 */

'use strict';

console.log('[Synapse Offscreen] Worker relay initialized.');

// ─────────────────────────────────────────────────────────────────────────────
// WORKER POOL
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, Worker>} */
const workerPool = new Map();

/**
 * Get or create a Worker for the given type.
 * @param {'compression'|'pdf'|'ocr'|'attachment'} type
 * @returns {Worker}
 */
function getWorker(type) {
  if (workerPool.has(type)) return workerPool.get(type);

  const url    = chrome.runtime.getURL(`workers/${type}.worker.js`);
  const worker = new Worker(url, { type: 'module' });

  worker.onerror = (event) => {
    console.error(`[Synapse Offscreen] Worker "${type}" crashed:`, event.message || event);
    workerPool.delete(type); // Allow recreation on next request

    // Reject all pending requests for this worker type
    for (const [taskId, pending] of pendingTasks) {
      if (pending.workerType === type) {
        pendingTasks.delete(taskId);
        pending.resolve({
          id:     taskId,
          status: 'error',
          error:  `Worker "${type}" crashed: ${event.message || 'Unknown error'}`
        });
      }
    }
  };

  worker.onmessage = (event) => {
    const result = event.data; // { id, status, result?, error?, message? }
    const taskId = result?.id;

    if (!taskId) {
      console.warn('[Synapse Offscreen] Worker message missing task ID:', result);
      return;
    }

    const pending = pendingTasks.get(taskId);
    if (!pending) {
      console.warn('[Synapse Offscreen] No pending task for ID:', taskId);
      return;
    }

    pendingTasks.delete(taskId);

    // Route result back to background via runtime message
    chrome.runtime.sendMessage({
      target: 'background',
      taskId,
      result
    }).catch(err => {
      // Background may have suspended — log and continue
      console.warn('[Synapse Offscreen] Could not relay result to background:', err.message);
      // Still call the resolve in case there's a local listener
      pending.resolve(result);
    });
  };

  workerPool.set(type, worker);
  return worker;
}

// ─────────────────────────────────────────────────────────────────────────────
// PENDING TASK TRACKING
// Keyed by taskId, value is { workerType, resolve }
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, { workerType: string, resolve: Function }>} */
const pendingTasks = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER (receives from background.js)
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages targeted at this offscreen document
  if (message?.target !== 'offscreen') return false;

  const { taskId, workerType, action, data } = message;

  if (!taskId || !workerType || !action) {
    sendResponse({
      id:     taskId,
      status: 'error',
      error:  'Offscreen: missing taskId, workerType, or action'
    });
    return false;
  }

  // Register the pending task with its sendResponse callback
  // (sendResponse is called when the worker replies via onmessage)
  pendingTasks.set(taskId, {
    workerType,
    resolve: (result) => {
      try {
        sendResponse(result);
      } catch {
        // sendResponse may already be closed if background timed out
      }
    }
  });

  // Dispatch to worker
  try {
    const worker = getWorker(workerType);
    worker.postMessage({ id: taskId, action, data });
  } catch (err) {
    pendingTasks.delete(taskId);
    sendResponse({
      id:     taskId,
      status: 'error',
      error:  `Failed to dispatch to "${workerType}" worker: ${err.message}`
    });
    return false;
  }

  return true; // Keep sendResponse channel open for async worker reply
});

// ─────────────────────────────────────────────────────────────────────────────
// PRE-WARM COMPRESSION WORKER
// Compression is needed on every capsule save — initialize it eagerly
// so the first save doesn't pay the worker startup cost.
// ─────────────────────────────────────────────────────────────────────────────

try {
  getWorker('compression');
  console.log('[Synapse Offscreen] Compression worker pre-warmed.');
} catch (err) {
  console.warn('[Synapse Offscreen] Could not pre-warm compression worker:', err.message);
}
