/**
 * Synapse v2 — Attachment Extraction Worker
 * Uses mammoth for DOCX extraction (plain text only).
 */

import mammoth from 'mammoth';

self.onmessage = async function (event) {
  const { id, action, data, fileName } = event.data;

  if (action === 'extract') {
    try {
      // data is an Array (from background message serialization)
      // Convert to Uint8Array buffer
      const buffer = new Uint8Array(data).buffer;
      
      let text = '';
      if (fileName && (fileName.endsWith('.docx') || fileName.endsWith('.doc'))) {
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        text = result.value;
      } else {
        // Fallback for other standard text files if somehow routed here
        text = new TextDecoder().decode(buffer);
      }

      self.postMessage({ id, status: 'extracted', result: text });
    } catch (err) {
      self.postMessage({ id, status: 'partial', message: `DOCX extraction failed: ${err.message}` });
    }
    return;
  }

  self.postMessage({ id, status: 'error', message: `Unknown action: ${action}` });
};
