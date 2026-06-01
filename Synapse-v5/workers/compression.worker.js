// src/workers/compression.worker.js
self.onmessage = async function(event) {
  const { id, action, data } = event.data;
  try {
    if (action === "compress") {
      const result = await compress(data);
      self.postMessage({ id, status: "ok", result });
    } else if (action === "decompress") {
      const result = await decompress(data);
      self.postMessage({ id, status: "ok", result });
    } else {
      self.postMessage({
        id,
        status: "error",
        error: `Unknown compression action: "${action}"`
      });
    }
  } catch (err) {
    self.postMessage({
      id,
      status: "error",
      error: err.message || "Compression worker encountered an unknown error"
    });
  }
};
async function compress(str) {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(str);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(inputBytes);
  writer.close();
  const buffer = await readStream(cs.readable);
  return uint8ToBase64(new Uint8Array(buffer));
}
async function decompress(b64) {
  const compressedBytes = base64ToUint8(b64);
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(compressedBytes);
  writer.close();
  const buffer = await readStream(ds.readable);
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}
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
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
function uint8ToBase64(bytes) {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}
function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
//# sourceMappingURL=compression.worker.js.map
