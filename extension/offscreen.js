// Offscreen document script for Synapse
console.log("[Synapse Offscreen] Sandbox initialized.");

// Listen to message routing from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.action === 'processContext') {
    const { topic, content } = message;
    console.log("[Synapse Offscreen] Processing content block for:", topic);

    // 1. Local AST Mock Pruning (regex-based fallbacks for parsing javascript/python functions)
    let codeSkeleton = '';
    if (content.includes('function') || content.includes('class ') || content.includes('def ') || content.includes('import ')) {
      const lines = content.split('\n');
      const skeletonLines = [];
      
      lines.forEach(line => {
        if (line.includes('import ') || line.includes('from ')) {
          skeletonLines.push(line.trim());
        } else if (line.includes('class ') || line.includes('interface ')) {
          skeletonLines.push(line.replace(/\{.*/, '{...}').trim());
        } else if (line.includes('def ') || line.includes('function') || line.includes('public static')) {
          skeletonLines.push('  ' + line.replace(/\{.*/, '').replace(/:.*/, '').trim() + '(...);');
        }
      });
      
      if (skeletonLines.length > 0) {
        codeSkeleton = skeletonLines.slice(0, 12).join('\n') + '\n  // ... [AST pruned bodies]';
      }
    }

    // 2. Local Semantic Summarization Simulation
    const summary = content.length > 250 
      ? content.slice(0, 220).replace(/\n/g, ' ') + '... [Semantic summary compiled on edge]'
      : content;

    // 3. Generate a mock 10-Dimensional Vector Embedding slice
    // In full implementation, load Transformers.js here:
    // import { pipeline } from '@xenova/transformers';
    // const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    // const output = await extractor(content, { pooling: 'mean', normalize: true });
    // const embedding = Array.from(output.data);
    const mockEmbedding = Array.from({ length: 10 }, () => parseFloat((Math.random() * 2 - 1).toFixed(4)));

    const resultCapsule = {
      id: `cap-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
      topic: topic || "Captured context",
      summary: summary,
      codeSkeleton: codeSkeleton,
      embedding: mockEmbedding
    };

    sendResponse(resultCapsule);
  }
  return true; // Keep channel open
});
