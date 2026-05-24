// Background Service Worker for Synapse Chrome Extension

let offscreenCreated = false;

// Seed default capsules on installation
chrome.runtime.onInstalled.addListener(() => {
  const defaultCapsules = [
    {
      id: "cap-001",
      timestamp: Date.now(),
      topic: "JWT Cookie Rotation Middleware",
      summary: "Implements JWT validation and HTTP-only cookie-based refresh token rotation to prevent CSRF and session hijacking.",
      codeSkeleton: `import { Request, Response, NextFunction } from 'express';\n\nexport class AuthMiddleware {\n  public static verifyToken(req: Request, res: Response, next: NextFunction): Promise<void>;\n}`
    },
    {
      id: "cap-002",
      timestamp: Date.now() - 60000,
      topic: "Pandas DataFrame Memory Downcasting",
      summary: "Iterative optimization pipeline downcasting float/int columns and converting objects to categories, reducing DataFrame sizes.",
      codeSkeleton: `import pandas as pd\nimport numpy as np\n\ndef optimize_dataframe(df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:`
    },
    {
      id: "cap-003",
      timestamp: Date.now() - 120000,
      topic: "SQLite Vector virtual table (sqlite-vec)",
      summary: "Establishes a virtual SQLite table using the sqlite-vec extension to handle local KNN cosine distance search.",
      codeSkeleton: `CREATE VIRTUAL TABLE vec_items USING vec0(\n  id TEXT PRIMARY KEY,\n  embedding float[384] distance_metric=cosine\n);`
    }
  ];

  chrome.storage.local.get({ capsules: [] }, (data) => {
    if (data.capsules.length === 0) {
      chrome.storage.local.set({ capsules: defaultCapsules }, () => {
        console.log("[Synapse BG] Seeded default capsules into local storage.");
      });
    }
  });
});

// Create Offscreen Document to run WASM & ONNX Runtime (since WebGPU/WASM are restricted in MV3 Service Workers)
async function setupOffscreen() {
  if (offscreenCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'], // Correct Chrome MV3 enum value
      justification: 'Running ONNX embedding modules and Tree-Sitter parsing inside sandbox.'
    });
    offscreenCreated = true;
    console.log("[Synapse BG] Offscreen document loaded successfully.");
  } catch (err) {
    console.error("[Synapse BG] Failed to create offscreen document:", err);
  }
}

// Keep connection alive & handle runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCapsules') {
    // Retrieve stored capsules from chrome storage
    chrome.storage.local.get({ capsules: [] }, (data) => {
      let filtered = data.capsules;
      if (message.query) {
        const query = message.query.toLowerCase();
        filtered = data.capsules.filter(c => 
          c.topic.toLowerCase().includes(query) || 
          c.summary.toLowerCase().includes(query)
        );
      }
      sendResponse(filtered);
    });
    return true; // Keep message channel open for async response
  }

  if (message.action === 'createCapsule') {
    setupOffscreen().then(() => {
      // Small delay (200ms) to ensure offscreen.js registers its listeners
      setTimeout(() => {
        chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'processContext',
          topic: message.topic,
          content: message.content
        }, (processedData) => {
          if (!processedData) {
            console.warn("[Synapse BG] Offscreen processing returned empty. Storing fallback.");
            processedData = {
              id: `cap-${Date.now()}`,
              timestamp: Date.now(),
              topic: message.topic,
              summary: message.content.slice(0, 150) + '...',
              codeSkeleton: '',
              fullContent: message.content,
              embedding: Array.from({length: 10}, () => 0)
            };
          } else {
            // Keep a copy of the raw untruncated content
            processedData.fullContent = message.content;
          }

          // Store to local Chrome Storage
          chrome.storage.local.get({ capsules: [] }, (data) => {
            const updated = [processedData, ...data.capsules];
            chrome.storage.local.set({ capsules: updated }, () => {
              console.log("[Synapse BG] Stored new capsule successfully.");
              sendResponse({ success: true, capsule: processedData });
            });
          });
        });
      }, 200);
    });
    return true;
  }
});

// Clean up offscreen on suspend
chrome.runtime.onSuspend.addListener(() => {
  if (offscreenCreated) {
    chrome.offscreen.closeDocument();
    offscreenCreated = false;
  }
});
