/**
 * Synapse v2 — PDF Extraction Worker
 * Uses pdfjs-dist for text extraction.
 */

import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

// Setup worker config
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('assets/pdf.worker.min.mjs');

self.onmessage = async function (event) {
  const { id, action, data } = event.data;

  if (action === 'extract') {
    try {
      const result = await extractPdfText(new Uint8Array(data));
      self.postMessage({ id, status: 'extracted', result });
    } catch (err) {
      self.postMessage({ id, status: 'partial', message: `PDF extraction failed: ${err.message}` });
    }
    return;
  }

  self.postMessage({ id, status: 'error', message: `Unknown action: ${action}` });
};

async function extractPdfText(uint8Array) {
  const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
  const pdfDocument = await loadingTask.promise;
  
  const numPages = pdfDocument.numPages;
  const maxPages = Math.min(numPages, 50); // Phase 4 Limit: 50 pages max
  const maxChars = 500000; // Phase 4 Limit: 500k chars max
  
  let fullText = '';

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n\n';

    if (fullText.length >= maxChars) {
      fullText = fullText.substring(0, maxChars) + '\n\n[...Truncated due to 500k character limit...]';
      break;
    }
  }

  return fullText.trim();
}
