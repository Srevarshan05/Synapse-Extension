/**
 * Synapse v2 — Compression Worker
 * Uses native CompressionStream / DecompressionStream (available Chrome 80+).
 * No external libraries required.
 *
 * Message protocol (in/out):
 *   Input:  { id: string, action: 'compress'|'decompress', data: string }
 *   Output: { id: string, status: 'ok'|'error', result?: string, error?: string }
 *
 * compress: string → gzip → base64 string
 * decompress: base64 string → ungzip → original string
 */

self.onmessage = async function (event) {
  const { id, action, data } = event.data;

  try {
    if (action === 'compress') {
      const result = await compress(data);
      self.postMessage({ id, status: 'ok', result });

    } else if (action === 'decompress') {
      const result = await decompress(data);
      self.postMessage({ id, status: 'ok', result });

    } else {
      self.postMessage({
        id,
        status: 'error',
        error: `Unknown compression action: "${action}"`
      });
    }
  } catch (err) {
    self.postMessage({
      id,
      status: 'error',
      error: err.message || 'Compression worker encountered an unknown error'
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPRESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compress a UTF-8 string to a base64-encoded gzip string.
 * @param {string} str
 * @returns {Promise<string>} base64-encoded compressed bytes
 */
async function compress(str) {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(str);

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();

  writer.write(inputBytes);
  writer.close();

  const buffer = await readStream(cs.readable);
  return uint8ToBase64(new Uint8Array(buffer));
}

// ─────────────────────────────────────────────────────────────────────────────
// DECOMPRESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decompress a base64-encoded gzip string back to the original UTF-8 string.
 * @param {string} b64
 * @returns {Promise<string>}
 */
async function decompress(b64) {
  const compressedBytes = base64ToUint8(b64);

  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();

  writer.write(compressedBytes);
  writer.close();

  const buffer = await readStream(ds.readable);
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAM UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collect all chunks from a ReadableStream into a single ArrayBuffer.
 * @param {ReadableStream} readable
 * @returns {Promise<ArrayBuffer>}
 */
async function readStream(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.byteLength;
  }

  // Concatenate all chunks into one Uint8Array
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE64 UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode Uint8Array to base64 string.
 * Uses chunked fromCharCode to avoid call stack overflow on large inputs.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

/**
 * Decode base64 string to Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
