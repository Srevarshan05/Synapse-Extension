/**
 * Synapse v3 — Content Script Entry Point (Bundled via Vite)
 *
 * Save Pipeline Fix:
 *   - Capture result is NEVER sent over chrome.runtime.sendMessage (IPC size limit)
 *   - Capsule is staged in local memory (window.__synapseStaged)
 *   - Popup receives only { status: 'staged', jobId, completeness, messageCount }
 *   - Background fetches the staged capsule via CAPSULE_FETCH_STAGED
 *   - Background processes async (compress → encrypt → chunk → write)
 *   - Background notifies popup via CAPSULE_SAVE_COMPLETE broadcast
 */

// ── Guard against double injection ────────────────────────────────────────────
if (window.__synapseV3Loaded) {
  console.log('[Synapse v3] Already loaded, skipping re-init.');
} else {
  window.__synapseV3Loaded = true;
  initSynapse();
}

import { getAdapterForHostname } from '../../extension/adapters/registry.js';
import { capture } from '../../extension/core/capture-engine.js';
import { hydrate } from '../../extension/core/hydration-engine.js';

function initSynapse() {
  const VERSION  = '3.0.0';
  const BADGE_ID = 'synapse-v3-status-badge';

  const CAPTURE_LIMITS = {
    maxMessages:    3000,
    maxAttachments: 100
  };

  const PLATFORM_COLORS = {
    chatgpt:    '#10a37f',
    claude:     '#d97706',
    gemini:     '#4285f4',
    deepseek:   '#7c3aed',
    kimi:       '#06b6d4',
    grok:       '#e11d48',
    copilot:    '#0078d4',
    perplexity: '#20b2aa',
    poe:        '#6366f1',
    openrouter: '#f97316',
    mistral:    '#e85d04',
    qwen:       '#16a34a'
  };

  // ── Staged capsule store (stays in content script memory, never crosses IPC)
  // Key: jobId, Value: capsule object
  const _staged = new Map();

  function stageJob(capsule) {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    _staged.set(jobId, capsule);
    // Auto-expire staged capsules after 10 minutes (memory safety)
    setTimeout(() => _staged.delete(jobId), 10 * 60 * 1000);
    return jobId;
  }

  // ── Detect Platform ──────────────────────────────────────────────────────
  let currentAdapter  = getAdapterForHostname(window.location.hostname);
  let currentPlatform = currentAdapter ? currentAdapter.platformId : null;

  if (!currentPlatform) {
    console.log(`[Synapse v3] Unrecognized platform: ${window.location.hostname}`);
  } else {
    console.log(`[Synapse v3] Initialized on ${currentPlatform} (v${VERSION})`);
  }

  // ── Status Indicator ─────────────────────────────────────────────────────
  function injectStatusBadge() {
    if (document.getElementById(BADGE_ID)) return;
    if (!currentPlatform) return;

    if (!document.getElementById('synapse-v3-styles')) {
      const style = document.createElement('style');
      style.id = 'synapse-v3-styles';
      style.textContent = `
        #${BADGE_ID} {
          position: fixed; bottom: 16px; right: 16px;
          width: 10px; height: 10px; border-radius: 50%;
          z-index: 2147483647; pointer-events: none;
          opacity: 0; transition: opacity 0.5s ease;
        }
        #${BADGE_ID}.visible { opacity: 0.65; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    const color = PLATFORM_COLORS[currentPlatform] || '#8b5cf6';
    const badge = document.createElement('div');
    badge.id = BADGE_ID;
    badge.setAttribute('title', `Synapse v3 · ${currentPlatform} · Local active`);
    badge.style.backgroundColor = color;
    badge.style.boxShadow       = `0 0 6px ${color}80`;
    document.body.appendChild(badge);
    requestAnimationFrame(() => setTimeout(() => badge.classList.add('visible'), 120));
  }

  // ── SPA Navigation ───────────────────────────────────────────────────────
  let lastUrl = window.location.href;

  function handleNavigation() {
    const newUrl = window.location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;

    const newAdapter  = getAdapterForHostname(window.location.hostname);
    const newPlatform = newAdapter ? newAdapter.platformId : null;

    if (newPlatform && newPlatform !== currentPlatform) {
      currentPlatform = newPlatform;
      currentAdapter  = newAdapter;
      console.log(`[Synapse v3] SPA navigation → ${currentPlatform}`);
    }

    if (currentPlatform && !document.getElementById(BADGE_ID)) {
      injectStatusBadge();
    }
  }

  const navObserver = new MutationObserver(handleNavigation);
  navObserver.observe(document.documentElement, { subtree: true, childList: true });

  const _pushState    = history.pushState.bind(history);
  const _replaceState = history.replaceState.bind(history);
  history.pushState    = (...a) => { _pushState(...a);    setTimeout(handleNavigation, 50); };
  history.replaceState = (...a) => { _replaceState(...a); setTimeout(handleNavigation, 50); };
  window.addEventListener('popstate', () => setTimeout(handleNavigation, 50));

  // ── Message Listener ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message?.action) {

      // ── PING — always respond (lets popup verify injection) ───────────────
      case 'PING':
        sendResponse({ alive: true, platform: currentPlatform, version: VERSION, limits: CAPTURE_LIMITS });
        return false;

      // ── CAPTURE — capture and STAGE locally, never send capsule over IPC ──
      case 'CAPTURE_START': {
        if (!currentAdapter) {
          sendResponse({ status: 'error', error: 'No adapter for this platform.' });
          return false;
        }

        (async () => {
          try {
            const level   = message.level || 'standard';
            const t0      = Date.now();

            const capsule = await capture(currentAdapter, level, {
              onProgress: (state) => {
                try { chrome.runtime.sendMessage({ action: 'CAPTURE_PROGRESS', state }); }
                catch { /* popup may be closed — non-critical */ }
              }
            });

            const elapsed      = Date.now() - t0;
            const completeness = capsule.captureReport?.completeness ?? 100;
            const msgCount     = capsule.captureReport?.messagesCaptured ?? 0;

            // ── KEY CHANGE: STAGE locally, return only tiny descriptor ──────
            const jobId = stageJob(capsule);

            console.log(`[Synapse v3] Capture staged: jobId=${jobId}, ${msgCount} msgs, ${elapsed}ms`);

            sendResponse({
              status:          'staged',   // NOT 'success' with capsule attached
              jobId,                        // background uses this to fetch
              completeness,
              lowCompleteness: completeness < 95,
              messageCount:    msgCount,
              title:           capsule.title || 'Untitled Chat',
              platform:        capsule.platform,
              elapsed,
            });

          } catch (error) {
            console.error('[Synapse v3] Capture failed:', error);
            sendResponse({ status: 'error', error: error.message });
          }
        })();
        return true;
      }

      // ── CAPSULE_FETCH_STAGED_META — fetch skeleton + array sizes ──────────
      case 'CAPSULE_FETCH_STAGED_META': {
        const { jobId } = message;
        const capsule   = _staged.get(jobId);

        if (!capsule) {
          sendResponse({ status: 'error', error: `No staged capsule for jobId: ${jobId}` });
          return false;
        }

        sendResponse({
          status: 'ok',
          meta: {
            id:             capsule.id,
            schemaVersion:  capsule.schemaVersion  ?? 3,
            adapterVersion: capsule.adapterVersion ?? 1,
            platform:       capsule.platform       ?? 'unknown',
            createdAt:      capsule.createdAt      ?? Date.now(),
            title:          capsule.title          || 'Untitled Capture',
            pinned:         capsule.pinned         ?? false,
            captureLevel:   capsule.captureLevel   ?? 'standard',
            memory:         capsule.memory         ?? {},
            security:       capsule.security       ?? {},
            hydration:      capsule.hydration      ?? {},
            captureReport:  capsule.captureReport  ?? {},
            counts: {
              messages:    capsule.conversation?.messages?.length || 0,
              nodes:       capsule.graph?.nodes?.length           || 0,
              edges:       capsule.graph?.edges?.length           || 0,
              attachments: capsule.attachments?.length            || 0,
              snippets:    capsule.code?.snippets?.length         || 0
            }
          }
        });
        return false;
      }

      // ── CAPSULE_FETCH_STAGED_PART — fetch a slice of a partition ──────────
      case 'CAPSULE_FETCH_STAGED_PART': {
        const { jobId, part, startIndex, count } = message;
        const capsule = _staged.get(jobId);

        if (!capsule) {
          sendResponse({ status: 'error', error: `No staged capsule for jobId: ${jobId}` });
          return false;
        }

        let items = [];
        if (part === 'messages') {
          items = capsule.conversation?.messages || [];
        } else if (part === 'nodes') {
          items = capsule.graph?.nodes || [];
        } else if (part === 'edges') {
          items = capsule.graph?.edges || [];
        } else if (part === 'attachments') {
          items = capsule.attachments || [];
        } else if (part === 'snippets') {
          items = capsule.code?.snippets || [];
        }

        const slice = items.slice(startIndex, startIndex + count);
        sendResponse({ status: 'ok', slice });
        return false;
      }

      // ── CAPSULE_FETCH_STAGED_CLEANUP — cleanup staged capsule ──────────────
      case 'CAPSULE_FETCH_STAGED_CLEANUP': {
        const { jobId } = message;
        _staged.delete(jobId);
        sendResponse({ status: 'ok' });
        return false;
      }

      // ── HYDRATE ───────────────────────────────────────────────────────────
      case 'HYDRATE_START': {
        if (!currentAdapter) {
          sendResponse({ status: 'error', error: 'No adapter for this platform.' });
          return false;
        }

        (async () => {
          try {
            const mode      = message.mode || 'preview';
            const capsuleId = message.capsuleId;
            if (!capsuleId) throw new Error('No capsuleId provided for hydration');

            const bgResponse = await new Promise(resolve =>
              chrome.runtime.sendMessage({
                action: 'DESKTOP_HYDRATE',
                payload: { capsule_id: capsuleId }
              }, resolve)
            );

            if (!bgResponse?.success || !bgResponse.continuation) {
              throw new Error(bgResponse?.error || 'Failed to retrieve continuation from Desktop companion.');
            }

            // Parse the real capsule from Desktop Companion (contains messages, title, platform, raw_items, etc.)
            const realCapsule = JSON.parse(bgResponse.continuation);

            const report = await hydrate(currentAdapter, realCapsule, mode);
            sendResponse({ status: 'success', report });
          } catch (error) {
            console.error('[Synapse v3] Hydration failed:', error);
            sendResponse({ status: 'error', error: error.message });
          }
        })();
        return true;
      }

      default:
        return false;
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  if (document.body) {
    injectStatusBadge();
  } else {
    const bodyWatcher = new MutationObserver(() => {
      if (document.body) { bodyWatcher.disconnect(); injectStatusBadge(); }
    });
    bodyWatcher.observe(document.documentElement, { childList: true });
  }
}
