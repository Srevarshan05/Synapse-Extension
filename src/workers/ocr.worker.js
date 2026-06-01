/**
 * Synapse v2 — OCR Worker
 * Uses tesseract.js for image extraction.
 */

import Tesseract from 'tesseract.js';

let workerPromise = null;

async function getTesseractWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    // Configure paths for offline MV3 environment
    const workerUrl = chrome.runtime.getURL('assets/tesseract-worker.min.js');
    const coreUrl = chrome.runtime.getURL('assets/tesseract-core.wasm.js');
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: workerUrl,
      corePath: coreUrl,
      langPath: chrome.runtime.getURL('assets')
    });
    return worker;
  })();

  return workerPromise;
}

self.onmessage = async function (event) {
  const { id, action, data } = event.data;

  if (action === 'extract') {
    try {
      const buffer = new Uint8Array(data).buffer;
      
      const worker = await getTesseractWorker();

      // Enforce 10s timeout on OCR recognition
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OCR Timeout (10s limit)')), 10000)
      );
      
      const recognizePromise = worker.recognize(buffer);
      
      const ret = await Promise.race([recognizePromise, timeoutPromise]);
      const text = ret.data.text.trim();

      self.postMessage({ id, status: 'extracted', result: text });
    } catch (err) {
      console.warn('[Synapse OCR]', err.message);
      self.postMessage({ id, status: 'partial', message: `OCR failed/timed-out: ${err.message}` });
    }
    return;
  }

  self.postMessage({ id, status: 'error', message: `Unknown action: ${action}` });
};
