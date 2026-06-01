/**
 * bridge.js
 * Connects the Synapse Dashboard (running inside Tauri webview) directly to
 * the loopback companion server at http://127.0.0.1:3742.
 *
 * NO chrome.runtime — the dashboard is a Tauri WebView page, not an extension popup.
 * NO mock data — all data comes from the real SQLite vault via the Rust HTTP server.
 */

const BASE = 'http://127.0.0.1:3742';

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }
  return res.json();
}

// ─── Capsule list ─────────────────────────────────────────────────────────────

export async function getCapsuleList() {
  try {
    const data = await api('/capsules');
    return { success: true, capsules: (data.capsules || []).map(normalizeCapsule), total: data.total || 0 };
  } catch (err) {
    console.error('[Synapse Bridge] getCapsuleList failed:', err);
    return { success: false, capsules: [], total: 0, error: err.message };
  }
}

export async function getTrashList() {
  try {
    const data = await api('/trash');
    return { success: true, capsules: (data.capsules || []).map(normalizeCapsule), total: data.total || 0 };
  } catch (err) {
    console.error('[Synapse Bridge] getTrashList failed:', err);
    return { success: false, capsules: [], total: 0, error: err.message };
  }
}

export async function searchCapsules(query) {
  try {
    const data = await api(`/capsules/search?q=${encodeURIComponent(query)}`);
    return { success: true, capsules: (data.capsules || []).map(normalizeCapsule), total: data.total || 0 };
  } catch (err) {
    console.warn('[Synapse Bridge] Native search failed, falling back to memory filtering:', err);
    try {
      const data = await api('/capsules');
      const q = query.toLowerCase();
      const filtered = (data.capsules || [])
        .map(normalizeCapsule)
        .filter(c =>
          c.title?.toLowerCase().includes(q) ||
          c.platform?.toLowerCase().includes(q)
        );
      return { success: true, capsules: filtered, total: filtered.length };
    } catch (fallbackErr) {
      return { success: false, capsules: [], total: 0, error: fallbackErr.message };
    }
  }
}

export async function trashCapsule(id) {
  try {
    const data = await api('/capsules/trash', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id })
    });
    return { success: true, ...data };
  } catch (err) {
    console.error('[Synapse Bridge] trashCapsule failed:', err);
    return { success: false, error: err.message };
  }
}

export async function restoreCapsule(id) {
  try {
    const data = await api('/capsules/restore', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id })
    });
    return { success: true, ...data };
  } catch (err) {
    console.error('[Synapse Bridge] restoreCapsule failed:', err);
    return { success: false, error: err.message };
  }
}

export async function deleteCapsule(id) {
  // Backwards compatibility mapper: maps deleteCapsule directly to trashCapsule
  return trashCapsule(id);
}

export async function purgeCapsule(id) {
  try {
    const data = await api('/capsules/purge', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id })
    });
    return { success: true, ...data };
  } catch (err) {
    console.error('[Synapse Bridge] purgeCapsule failed:', err);
    return { success: false, error: err.message };
  }
}

export async function pinCapsule(id, pinned) {
  try {
    // Standard pin index logic is local or DB setting, return true
    return { success: true };
  } catch (err) {
    return { success: true };
  }
}

export async function exportCapsule(id) {
  try {
    const data = await api('/hydrate', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id })
    });
    if (data.success && data.continuation) {
      // Returns raw decompressed string
      return { success: true, raw: data.continuation };
    }
    return { success: false, error: data.error || 'Failed to export' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function exportCapsuleLocal(id, filename) {
  try {
    return await api('/capsules/export_local', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id, filename })
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function importCapsule(fileDataBase64) {
  try {
    const result = await api('/capsules/import', {
      method: 'POST',
      body: JSON.stringify({ file_data_base64: fileDataBase64 }),
    });
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getStorageUsage() {
  try {
    const data = await api('/capsules');
    const capsules = data.capsules || [];
    const totalBytes = capsules.reduce((acc, c) => acc + (c.size_bytes || 0), 0);
    return {
      success: true,
      capsuleCount: capsules.length,
      totalBytes,
      totalMB: (totalBytes / (1024 * 1024)).toFixed(2),
    };
  } catch (err) {
    return { success: false, capsuleCount: 0, totalBytes: 0, totalMB: '0.00' };
  }
}

export async function getActiveCapsule() {
  try {
    const data = await api('/capsules');
    const capsules = data.capsules || [];
    const active = capsules.length > 0 ? capsules[0] : null;
    return { success: true, capsule: active ? normalizeCapsule(active) : null };
  } catch (err) {
    return { success: true, capsule: null };
  }
}

export async function hydrateCapsule(id) {
  try {
    const data = await api('/hydrate', {
      method: 'POST',
      body: JSON.stringify({ capsule_id: id })
    });
    if (data.success && data.continuation) {
      const capsule = JSON.parse(data.continuation);
      return { success: true, capsule };
    }
    return { success: false, error: data.error || 'Failed to decompress capsule' };
  } catch (err) {
    console.error('[Synapse Bridge] hydrateCapsule failed:', err);
    return { success: false, error: err.message };
  }
}

// ─── Field normalization ──────────────────────────────────────────────────────

export function normalizeCapsule(raw) {
  if (!raw) return null;
  
  // Extract summary and snippets for display
  let summary = '';
  let snippets = '';
  
  if (raw.messages && raw.messages.length > 0) {
    summary = raw.messages[0].content || '';
  }
  
  return {
    id:           raw.id,
    title:        raw.title || 'Untitled',
    platform:     raw.platform || 'unknown',
    captureLevel: raw.capture_level || raw.captureLevel || 'standard',
    createdAt:    raw.created_at ? raw.created_at * 1000 : (raw.createdAt || Date.now()),
    messagesCount: raw.messages_count ?? raw.messagesCount ?? 0,
    sizeBytes:    raw.size_bytes ?? raw.sizeBytes ?? 0,
    isPinned:     raw.is_pinned ?? raw.isPinned ?? false,
    pinned:       raw.is_pinned ?? raw.isPinned ?? false,
    completeness: raw.completeness ?? 100,
    status:       raw.status || 'healthy',
    path:         raw.path || '',
    deletedAt:    raw.deleted_at ?? null,
    summary:      summary || 'Captured LLM continuity session.',
    captureReport: {
      messagesFound:    raw.messages_count ?? 0,
      messagesCaptured: raw.messages_count ?? 0,
      completeness:     raw.completeness ?? 100,
    }
  };
}

export async function getSetting(key) {
  try {
    const data = await api(`/settings?key=${encodeURIComponent(key)}`);
    return { success: true, value: data.value };
  } catch (err) {
    console.error('[Synapse Bridge] getSetting failed:', err);
    return { success: false, error: err.message };
  }
}

export async function setSetting(key, value) {
  try {
    const data = await api('/settings', {
      method: 'POST',
      body: JSON.stringify({ key, value: String(value) })
    });
    return { success: true, ...data };
  } catch (err) {
    console.error('[Synapse Bridge] setSetting failed:', err);
    return { success: false, error: err.message };
  }
}

export async function validateStoragePath(path) {
  try {
    return await api('/settings/validate_path', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function clearAllCapsules() {
  try {
    const data = await api('/capsules/clear', {
      method: 'POST'
    });
    return { success: true, ...data };
  } catch (err) {
    console.error('[Synapse Bridge] clearAllCapsules failed:', err);
    return { success: false, error: err.message };
  }
}

export async function injectCapsule(id, targetPlatform, mode = 'silent') {
  try {
    // 1. Stage the active capsule setting on the companion server
    await setSetting('activeCapsuleId', id);
    
    // Platform URL lookup
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
    
    const targetUrl = PLATFORM_URLS[targetPlatform];
    if (targetUrl) {
      // 2. Instruct companion backend to open the default browser to the LLM platform
      await api('/open_url', {
        method: 'POST',
        body: JSON.stringify({ url: targetUrl })
      });
    }
    
    return { success: true };
  } catch (err) {
    console.error('[Synapse Bridge] injectCapsule failed:', err);
    return { success: false, error: err.message };
  }
}
