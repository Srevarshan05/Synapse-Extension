/**
 * Synapse v3 — Attachment Engine
 * Discovers and extracts attachments from the DOM.
 */

const MAX_FILES = 100;

/**
 * Extracts attachments from a given message node or the whole document.
 * @param {Element} node - The DOM node to search within.
 * @param {import('./types.js').CaptureLevel} level - 'fast', 'standard', or 'deep'
 * @returns {import('./types.js').Attachment[]}
 */
export async function extractAttachments(node, level) {
  const attachments = [];
  
  if (level === 'fast') {
    return attachments; // Fast mode skips attachments
  }

  // Basic heuristics to find file attachments
  const fileNodes = Array.from(node.querySelectorAll('a[href], [data-file-id], [aria-label*="file"], .file-attachment, img'));

  let idCounter = 1;
  const names = new Set();

  for (const fNode of fileNodes) {
    if (attachments.length >= MAX_FILES) {
      console.warn(`[Synapse v3] Reached max attachments limit (${MAX_FILES}). Skipping remaining.`);
      break;
    }

    let name = fNode.getAttribute('title') || fNode.getAttribute('aria-label') || fNode.getAttribute('alt') || fNode.textContent?.trim() || 'Unknown File';
    let url = fNode.getAttribute('href') || fNode.getAttribute('src');

    // Skip if it doesn't look like a file or is an external link not related to attachments
    if (!name || name.length < 3 || name.length > 150) continue;
    if (names.has(name)) continue;

    let type = 'other';
    const lowerName = name.toLowerCase();
    
    // Categorize
    if (lowerName.endsWith('.pdf')) type = 'pdf';
    else if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) type = 'docx';
    else if (lowerName.endsWith('.txt')) type = 'txt';
    else if (lowerName.endsWith('.csv')) type = 'csv';
    else if (lowerName.endsWith('.json')) type = 'json';
    else if (lowerName.endsWith('.md')) type = 'md';
    else if (lowerName.match(/\.(zip|rar|tar|gz|7z)$/)) type = 'archive';
    else if (lowerName.match(/\.(exe|dmg|sh|bat)$/)) type = 'executable';
    else if (lowerName.match(/\.(mp4|mov|avi|mp3|wav)$/)) type = 'media';
    else if (lowerName.match(/\.(png|jpe?g|gif|webp|svg)$/) || fNode.tagName === 'IMG') {
      type = 'image';
      if (fNode.tagName === 'IMG' && name === 'Unknown File') name = `Image_${idCounter}.png`;
    }

    // Ignore unsupported types
    if (type === 'archive' || type === 'executable' || type === 'media') {
      attachments.push(createAttachmentMetadata(name, type, 'inaccessible', idCounter++));
      names.add(name);
      continue;
    }

    let status = 'partial'; // default until full extraction
    let textRef = null;
    let fullText = null;

    if (level === 'standard') {
      // Standard: metadata only
      status = 'partial';
      attachments.push(createAttachmentMetadata(name, type, status, idCounter++));
      names.add(name);
      continue;
    }

    if (level === 'deep') {
      // Discover -> Inspect -> Extract -> Discard
      if (url && (url.startsWith('blob:') || url.startsWith('http'))) {
        try {
           const extracted = await fetchAndExtract(url, type, name);
           if (extracted) {
             status = extracted.status;
             fullText = extracted.text;
           } else {
             status = 'inaccessible';
           }
        } catch (e) {
           console.warn(`[Synapse v3] Failed to extract ${name}:`, e);
           status = 'inaccessible';
        }
      } else {
        status = 'inaccessible';
      }

      const att = createAttachmentMetadata(name, type, status, idCounter++);
      if (fullText) att.fullText = fullText; // Will be split out by storage
      attachments.push(att);
      names.add(name);
    }
  }

  return attachments;
}

function createAttachmentMetadata(name, type, status, id) {
  return {
    id: `att-${Date.now()}-${id}`,
    name,
    type,
    status,
    summary: `${name} (${type})`,
    metadata: {}
  };
}

/**
 * Fetches blob, sends to background for extraction, discards blob.
 */
async function fetchAndExtract(url, type, name) {
  // Fetch only if needed
  const res = await fetch(url);
  const buffer = await res.arrayBuffer();
  
  if (buffer.byteLength > 10 * 1024 * 1024) {
    // Arbitrary size guard before sending to worker
    return { status: 'partial', text: '[File too large to extract locally]' };
  }

  // Convert ArrayBuffer to Array for Chrome IPC
  const dataArray = Array.from(new Uint8Array(buffer));

  // Dispatch to background which routes to appropriate worker
  const extractRes = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'EXTRACT_ATTACHMENT',
      type,
      name,
      dataArray
    }, resolve);
  });

  return extractRes;
}
