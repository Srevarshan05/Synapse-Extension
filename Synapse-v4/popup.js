/**
 * Synapse v3 — Popup Controller
 *
 * UX flow:
 *   1. Show current platform detection
 *   2. Load synapse list from Desktop → show most recent as selected
 *   3. User picks mode (Preview / Silent / Interactive)
 *   4. "Use Synapse" → premium hydration animation → inject → confirmation card
 *   5. "Smart Copy" → premium neural capture animation → save
 */

'use strict';

const PLATFORM_COLORS = {
  chatgpt:    '#10a37f', claude:     '#d97706', gemini:     '#4285f4',
  deepseek:   '#7c3aed', kimi:       '#06b6d4', grok:       '#e11d48',
  copilot:    '#0078d4', perplexity: '#20b2aa', poe:        '#6366f1',
  openrouter: '#f97316', mistral:    '#e85d04', qwen:       '#16a34a'
};

const PLATFORM_NAMES = {
  chatgpt:    'ChatGPT',  claude:     'Claude',      gemini:     'Gemini',
  deepseek:   'DeepSeek', kimi:       'Kimi',        grok:       'Grok',
  copilot:    'Copilot',  perplexity: 'Perplexity',  poe:        'Poe',
  openrouter: 'OpenRouter', mistral:  'Mistral',     qwen:       'Qwen'
};

const PLATFORM_DOMAINS = {
  'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude', 'gemini.google.com': 'gemini',
  'chat.deepseek.com': 'deepseek', 'kimi.moonshot.cn': 'kimi',
  'grok.com': 'grok', 'copilot.microsoft.com': 'copilot',
  'perplexity.ai': 'perplexity', 'poe.com': 'poe',
  'openrouter.ai': 'openrouter', 'chat.mistral.ai': 'mistral',
  'chat.qwen.ai': 'qwen'
};

// ─── State ────────────────────────────────────────────────────────────────────

let selectedCapsuleId = null;
let selectedMode      = 'silent';
let currentTab        = null;
let currentPlatform   = null;
let allCapsules       = [];
let capsuleListOpen   = false;
let _toastTimer       = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {

  // Load and apply theme first to prevent flash of wrong style
  await loadTheme();

  // Wire mode tabs
  ['preview', 'silent', 'interactive'].forEach(mode => {
    $(`mode-${mode}`).addEventListener('click', () => setMode(mode));
  });

  // Wire Use Synapse
  $('use-btn').addEventListener('click', handleUse);

  // Wire Smart Copy
  $('capture-btn').addEventListener('click', handleCapture);

  // Wire Dashboard
  $('open-dashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    window.close();
  });



  // Wire permission banner grant button
  $('perm-grant-btn')?.addEventListener('click', requestSitePermissions);
  $('perm-dismiss-btn')?.addEventListener('click', () => {
    $('perm-banner').style.display = 'none';
    chrome.storage.local.set({ snp_perm_dismissed: Date.now() });
  });

  // Check site permissions and show banner if not granted
  await checkAndShowPermissionBanner();

  // Detect platform
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab      = tab;
    currentPlatform = detectPlatform(tab?.url || '');
  } catch { /* permission not granted yet */ }

  updatePlatformUI(currentPlatform);

  // Load synapses from Desktop
  await loadCapsules();

  // Check Desktop connection status
  await checkDesktopStatus();
});

// ─── Site Permission Banner ───────────────────────────────────────────────────

const AI_SITE_PERMISSIONS = {
  origins: [
    'https://chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://chat.deepseek.com/*',
    'https://kimi.moonshot.cn/*',
    'https://grok.com/*',
    'https://copilot.microsoft.com/*',
    'https://www.perplexity.ai/*',
    'https://poe.com/*',
    'https://openrouter.ai/*',
    'https://chat.mistral.ai/*',
    'https://chat.qwen.ai/*',
  ]
};

async function checkAndShowPermissionBanner() {
  const banner = $('perm-banner');
  if (!banner) return;

  try {
    // If user already dismissed recently (within 7 days), don't show
    const stored = await chrome.storage.local.get('snp_perm_dismissed');
    const dismissed = stored?.snp_perm_dismissed || 0;
    if (Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) {
      banner.style.display = 'none';
      return;
    }

    // Check if all site permissions are granted
    const hasAll = await chrome.permissions.contains(AI_SITE_PERMISSIONS);
    if (hasAll) {
      banner.style.display = 'none';
      chrome.storage.local.remove('snp_perm_dismissed');
    } else {
      banner.style.display = 'flex';
    }
  } catch (e) {
    banner.style.display = 'none';
  }
}

async function requestSitePermissions() {
  const btn = $('perm-grant-btn');
  const banner = $('perm-banner');
  if (btn) { btn.disabled = true; btn.textContent = 'Requesting…'; }

  try {
    const granted = await chrome.permissions.request(AI_SITE_PERMISSIONS);
    if (granted) {
      banner.style.display = 'none';
      showToast('✓ Full site access granted — capture quality improved!', 'success', 3500);
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Grant Access'; }
      showToast('Permission denied. Some captures may be limited.', 'info', 3000);
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Grant Access'; }
    showToast('Could not request permissions: ' + e.message, 'error', 4000);
  }
}

function updatePlatformUI(platform) {
  const dot        = $('platform-dot');
  const text       = $('platform-text');
  const captureBtn = $('capture-btn');

  if (platform) {
    const color = PLATFORM_COLORS[platform] || '#9333ea';
    const name  = PLATFORM_NAMES[platform]  || platform;

    dot.style.background = color;
    dot.style.boxShadow  = `0 0 6px ${color}`;
    text.textContent     = `Active Platform: ${name}`;
    text.style.color     = 'var(--text)';
    captureBtn.disabled  = false;
  } else {
    dot.style.background = '#64748b';
    dot.style.boxShadow  = 'none';
    text.textContent     = 'No LLM platform detected';
    text.style.color     = 'var(--text-dim)';
    captureBtn.disabled  = true;
  }
}

// ─── Load Synapses ────────────────────────────────────────────────────────────

async function loadCapsules() {
  // Show skeleton while fetching
  $('capsule-skeleton').style.display = 'block';
  $('capsule-empty').style.display    = 'none';
  $('capsule-list').style.display     = 'none';
  $('mode-row').style.display         = 'none';
  $('use-btn').disabled               = true;

  try {
    const res   = await sendToBackground({ action: 'DESKTOP_CAPSULES_LIST' });
    allCapsules = res?.capsules || [];
  } catch {
    allCapsules = [];
  }

  // Hide skeleton
  $('capsule-skeleton').style.display = 'none';

  if (allCapsules.length === 0) {
    $('capsule-list').style.display     = 'none';
    $('capsule-empty').style.display    = 'block';
    $('mode-row').style.display         = 'none';
    $('use-btn').disabled               = true;
    loadStats();
    return;
  }

  // Select most recent by default (if not already selected)
  if (!selectedCapsuleId || !allCapsules.some(c => c.id === selectedCapsuleId)) {
    selectedCapsuleId = allCapsules[0].id;
  }

  $('capsule-empty').style.display    = 'none';
  $('capsule-list').style.display     = 'flex';
  $('mode-row').style.display         = 'flex';
  $('use-btn').disabled               = !currentPlatform;

  // Build picker cards
  renderCapsuleList();

  // Refresh stats
  loadStats();
}

function selectCapsule(capsule) {
  selectedCapsuleId = capsule.id;
  $('use-btn').disabled = !currentPlatform;
  renderCapsuleList();
}

function renderCapsuleList() {
  const list = $('capsule-list');
  list.innerHTML = '';

  const recent5 = allCapsules.slice(0, 5);

  for (const cap of recent5) {
    const color = PLATFORM_COLORS[cap.platform] || '#9333ea';
    const name  = PLATFORM_NAMES[cap.platform]  || cap.platform;
    const isSelected = cap.id === selectedCapsuleId;

    const card  = document.createElement('div');
    card.className = 'capsule-card' + (isSelected ? ' selected' : '');
    card.style.marginBottom = '2px';
    
    const when = cap.created_at ? formatTimeAgo(cap.created_at * 1000) : '—';
    const msgs = cap.messages_count ?? 0;

    card.innerHTML = `
      <div class="capsule-card-title">${escHtml(cap.title || 'Untitled')}</div>
      <div class="capsule-card-meta">
        <div class="capsule-platform-dot" style="background:${color}"></div>
        <span>${escHtml(name)} · ${when} · ${msgs} msgs</span>
      </div>`;

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCapsule(cap);
    });
    list.appendChild(card);
  }
}

// ─── Mode selector ────────────────────────────────────────────────────────────

function setMode(mode) {
  selectedMode = mode;
  ['preview', 'silent', 'interactive'].forEach(m => {
    $(`mode-${m}`).classList.toggle('active', m === mode);
  });
}

// ─── Use Synapse ──────────────────────────────────────────────────────────────

async function handleUse() {
  if (!selectedCapsuleId) {
    showToast('No synapse selected.', 'info');
    return;
  }
  if (!currentPlatform) {
    showToast('Navigate to a supported LLM first.', 'info');
    return;
  }

  const useBtn = $('use-btn');
  useBtn.disabled = true;
  useBtn.innerHTML = '<span class="spinner"></span> Loading…';

  // Show hydration animation overlay
  showHydrateOverlay();
  advanceHydrateStage(0); // Retrieving Context

  try {
    // Brief processing delay for fluid UX feel
    await new Promise(r => setTimeout(r, 650));
    advanceHydrateStage(1); // Preparing Conversation State

    // Ensure content script is alive in the current tab
    const alive = await ensureContentScript(currentTab.id);
    if (!alive) {
      throw new Error('Refresh the page (F5) and try again.');
    }

    advanceHydrateStage(2); // Synchronizing With Current Chat

    // Send hydration request to current tab's content script
    const res = await sendToTab(currentTab.id, {
      action:    'HYDRATE_START',
      capsuleId: selectedCapsuleId,
      mode:      selectedMode
    }, 25000);

    if (res?.status === 'success') {
      advanceHydrateStage(3); // Ready — mark all complete
      await new Promise(r => setTimeout(r, 500));
      showConfirmPanel();
      // Close popup after user sees confirmation
      setTimeout(() => window.close(), 2400);
    } else {
      throw new Error(res?.error || 'Injection failed.');
    }

  } catch (err) {
    console.error('[Synapse] Use Synapse error:', err);
    hideHydrateOverlay();
    showToast(err.message, 'error', 6000);
  } finally {
    useBtn.disabled = false;
    useBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      Use Synapse`;
  }
}

// ─── Smart Copy (Ingestion Streaming) ─────────────────────────────────────────

async function handleCapture() {
  if (!currentPlatform) {
    showToast('Navigate to a supported LLM first.', 'info');
    return;
  }

  // Pre-check Desktop connection before showing overlay
  const isConnected = await checkDesktopStatus();
  if (!isConnected) {
    showToast('Synapse Desktop is not running. Launch it first.', 'error');
    return;
  }

  const btn = $('capture-btn');
  btn.disabled = true;

  // Show capture animation overlay (all pre-checks passed)
  showCaptureOverlay();
  advanceCaptureStage(0); // Analyzing Conversation

  try {
    const alive = await ensureContentScript(currentTab.id);
    if (!alive) throw new Error('Refresh the page (F5) and try again.');

    let captureLevel = 'standard';
    try {
      const s = await sendToBackground({ action: 'SETTING_GET', key: 'captureLevel' }, 3000);
      if (s?.value) captureLevel = s.value;
    } catch { /* use default */ }

    // Set up a listener for progress and job update events during capture
    let jobUpdateHandler;
    const jobPromise = new Promise((resolve, reject) => {
      jobUpdateHandler = (msg) => {
        if (msg.action === 'CAPTURE_PROGRESS') {
          const { phase, messagesVisible, completeness } = msg.state || {};
          if (phase === 'loading' && messagesVisible) {
            advanceCaptureStage(1);
            showToast(`Loading ${messagesVisible} messages…`, 'info', 30000);
          } else if (phase === 'extract') {
            advanceCaptureStage(1);
            showToast('Extracting conversation content…', 'info', 30000);
          } else if (phase === 'graph') {
            advanceCaptureStage(2);
            showToast('Building conversation graph…', 'info', 30000);
          } else if (phase === 'verify') {
            advanceCaptureStage(3);
            showToast(`Verifying… ${completeness ?? '?'}% complete`, 'info', 30000);
          }
        } else if (msg.action === 'CAPSULE_JOB_UPDATE') {
          const { state, error, messageCount, completeness, part, progress, total } = msg;
          if (state === 'discovering') {
            advanceCaptureStage(0);
            showToast('Discovering conversation…', 'info', 30000);
          } else if (state === 'loading') {
            advanceCaptureStage(1);
            showToast('Staging conversation metadata…', 'info', 30000);
          } else if (state === 'streaming') {
            advanceCaptureStage(2);
            showToast(`Streaming ${part}… ${progress}/${total}`, 'info', 30000);
          } else if (state === 'building') {
            advanceCaptureStage(3);
            showToast('Compiling and saving…', 'info', 30000);
          } else if (state === 'complete') {
            // Stage 4 active (Capture Complete), then all complete, then dismiss
            advanceCaptureStage(4);
            showToast(`Saved · ${messageCount} msgs · ${completeness}% complete`, 'success', 5000);
            setTimeout(() => {
              advanceCaptureStage(5); // 5 >= TOTAL(5) → marks all stages complete
              setTimeout(() => {
                hideCaptureOverlay();
                loadCapsules();
              }, 700);
            }, 900);
            resolve();
          } else if (state === 'failed') {
            hideCaptureOverlay();
            showToast(`Capture failed: ${error}`, 'error', 6000);
            reject(new Error(error));
          }
        }
      };
      chrome.runtime.onMessage.addListener(jobUpdateHandler);
    });

    // ── Delegate the entire capture flow to the background script
    const jobRes = await sendToBackground({
      action: 'START_CAPTURE_FLOW',
      tabId:  currentTab.id,
      captureLevel,
      platform: currentPlatform
    }, 5000);

    if (!jobRes || !jobRes.jobId) {
      throw new Error('Failed to start capture. Please try again.');
    }

    // Wait for the background job to complete via event listener
    await jobPromise;

    // Cleanup listener
    if (jobUpdateHandler) {
      chrome.runtime.onMessage.removeListener(jobUpdateHandler);
    }

  } catch (err) {
    console.error('[Synapse] Capture error:', err);
    hideCaptureOverlay();
    showToast(err.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    await checkDesktopStatus();
  }
}

// ─── Desktop Status UX ────────────────────────────────────────────────────────

async function checkDesktopStatus() {
  const dot  = $('desktop-dot');
  const text = $('desktop-text');
  const btn  = $('capture-btn');
  try {
    const res = await sendToBackground({ action: 'DESKTOP_STATUS' }, 2000);
    if (res && res.status) {
      dot.style.background = '#10b981';
      dot.style.boxShadow  = '0 0 6px #10b981';
      text.textContent     = `Desktop Connected (${res.status})`;
      text.style.color     = 'var(--text)';
      btn.disabled         = !currentPlatform;
      return true;
    }
  } catch {}

  dot.style.background = '#ef4444';
  dot.style.boxShadow  = 'none';
  text.innerHTML       = 'Synapse Desktop not running. <span style="text-decoration:underline; cursor:pointer;" id="open-desktop-lnk">Open?</span>';
  text.style.color     = 'var(--text-dim)';
  btn.disabled         = true;

  const lnk = $('open-desktop-lnk');
  if (lnk) {
    lnk.addEventListener('click', () => {
      chrome.tabs.create({ url: 'http://127.0.0.1:3742/status' });
    });
  }
  return false;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

async function loadStats() {
  const count      = allCapsules.length;
  let   totalBytes = 0;
  for (const cap of allCapsules) totalBytes += cap.size_bytes || 0;

  $('stat-capsules').textContent = count;
  const kb = totalBytes / 1024;
  $('stat-size').textContent = kb < 1024
    ? `${Math.round(kb)}KB`
    : `${(kb / 1024).toFixed(1)}MB`;
}

// ─── Messaging helpers ────────────────────────────────────────────────────────

function sendToBackground(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: ${message.action}`)), timeoutMs
    );
    chrome.runtime.sendMessage(message, res => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function sendToTab(tabId, message, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${message.action}`)), timeoutMs
    );
    try {
      chrome.tabs.sendMessage(tabId, message, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    } catch (err) { clearTimeout(timer); reject(err); }
  });
}

async function ensureContentScript(tabId) {
  const ping = await new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 1500);
    try {
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, res => {
        clearTimeout(t);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    } catch { clearTimeout(t); resolve(null); }
  });

  if (ping?.alive) return true;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.bundle.js'] });
    await new Promise(r => setTimeout(r, 600));
    const ping2 = await new Promise(resolve => {
      const t = setTimeout(() => resolve(null), 2000);
      chrome.tabs.sendMessage(tabId, { action: 'PING' }, res => {
        clearTimeout(t);
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    });
    return !!ping2?.alive;
  } catch { return false; }
}

async function loadTheme() {
  try {
    const res = await sendToBackground({ action: 'SETTING_GET', key: 'synapse-theme' });
    if (res && res.value) {
      setTheme(res.value);
    } else {
      // Fallback: Query loopback server settings route directly
      const sRes = await fetch('http://127.0.0.1:3742/settings?key=synapse-theme');
      if (sRes.ok) {
        const data = await sRes.json();
        if (data.success && data.value) {
          setTheme(data.value);
          return;
        }
      }
      setTheme('dark'); // Default to dark theme
    }
  } catch (err) {
    console.warn('[Synapse] Theme detection query failed:', err);
    setTheme('dark'); // Default to dark theme
  }
}

function setTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showToast(msg, type = 'info', duration = 3500) {
  const el    = $('toast');
  el.textContent = msg;
  el.className   = `toast ${type} visible`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
}

function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname;
    for (const [domain, platform] of Object.entries(PLATFORM_DOMAINS)) {
      if (hostname.includes(domain)) return platform;
    }
  } catch { /* invalid URL */ }
  return null;
}

function formatTimeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Capture Animation Overlay ────────────────────────────────────────────────

const CAPTURE_TOTAL = 5; // stages 0 – 4

function showCaptureOverlay() {
  const overlay = $('capture-overlay');
  // Reset all stages to pending state
  for (let i = 0; i < CAPTURE_TOTAL; i++) {
    const node   = $(`cs-node-${i}`);
    const conn   = $(`cs-conn-${i}`);
    const status = $(`cs-status-${i}`);
    if (node)   node.className   = 'stage-node';
    if (conn)   conn.className   = 'stage-connector';
    if (status) { status.textContent = 'Waiting'; status.className = 'stage-status'; }
  }
  // Fade in
  overlay.style.opacity    = '0';
  overlay.style.display    = 'flex';
  overlay.style.transition = 'none';
  requestAnimationFrame(() => {
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.opacity    = '1';
  });
}

function hideCaptureOverlay() {
  const overlay = $('capture-overlay');
  if (overlay.style.display === 'none') return;
  overlay.style.transition = 'opacity 0.3s ease';
  overlay.style.opacity    = '0';
  setTimeout(() => {
    overlay.style.display    = 'none';
    overlay.style.opacity    = '';
    overlay.style.transition = '';
  }, 330);
}

/**
 * Advance the capture stage pipeline.
 * - Stages < `stage` are marked complete (green check, filled connector)
 * - Stage === `stage` is active (spinner + pulse ring)
 * - Stages > `stage` remain pending
 * - If `stage` >= CAPTURE_TOTAL, ALL stages are marked complete.
 */
function advanceCaptureStage(stage) {
  for (let i = 0; i < CAPTURE_TOTAL; i++) {
    const node   = $(`cs-node-${i}`);
    const conn   = $(`cs-conn-${i}`);
    const status = $(`cs-status-${i}`);

    if (stage >= CAPTURE_TOTAL || i < stage) {
      // Completed
      if (node)   node.className   = 'stage-node complete';
      if (conn)   conn.className   = 'stage-connector filled';
      if (status) { status.textContent = 'Done'; status.className = 'stage-status done'; }
    } else if (i === stage) {
      // Active
      if (node)   node.className   = 'stage-node active';
      if (conn)   conn.className   = 'stage-connector';
      if (status) { status.textContent = 'Processing…'; status.className = 'stage-status active'; }
    } else {
      // Pending
      if (node)   node.className   = 'stage-node';
      if (conn)   conn.className   = 'stage-connector';
      if (status) { status.textContent = 'Waiting'; status.className = 'stage-status'; }
    }
  }
}

// ─── Hydration Animation Overlay ──────────────────────────────────────────────

const HYDRATE_TOTAL = 4; // stages 0 – 3

function showHydrateOverlay() {
  const overlay = $('hydrate-overlay');
  const wrap    = $('hydrate-stage-wrap');
  const confirm = $('confirm-panel');

  // Reset all stages to pending state
  for (let i = 0; i < HYDRATE_TOTAL; i++) {
    const node   = $(`hs-node-${i}`);
    const conn   = $(`hs-conn-${i}`);
    const status = $(`hs-status-${i}`);
    if (node)   node.className   = 'stage-node';
    if (conn)   conn.className   = 'stage-connector';
    if (status) { status.textContent = 'Waiting'; status.className = 'stage-status'; }
  }

  if (wrap)    { wrap.style.display = 'flex'; wrap.style.opacity = '1'; wrap.style.transition = ''; }
  if (confirm) confirm.style.display = 'none';

  // Fade in
  overlay.style.opacity    = '0';
  overlay.style.display    = 'flex';
  overlay.style.transition = 'none';
  requestAnimationFrame(() => {
    overlay.style.transition = 'opacity 0.3s ease';
    overlay.style.opacity    = '1';
  });
}

function hideHydrateOverlay() {
  const overlay = $('hydrate-overlay');
  if (overlay.style.display === 'none') return;
  overlay.style.transition = 'opacity 0.3s ease';
  overlay.style.opacity    = '0';
  setTimeout(() => {
    overlay.style.display    = 'none';
    overlay.style.opacity    = '';
    overlay.style.transition = '';
  }, 330);
}

/**
 * Advance the hydration stage pipeline.
 * If `stage` >= HYDRATE_TOTAL, ALL stages are marked complete.
 */
function advanceHydrateStage(stage) {
  for (let i = 0; i < HYDRATE_TOTAL; i++) {
    const node   = $(`hs-node-${i}`);
    const conn   = $(`hs-conn-${i}`);
    const status = $(`hs-status-${i}`);

    if (stage >= HYDRATE_TOTAL || i < stage) {
      // Completed
      if (node)   node.className   = 'stage-node complete';
      if (conn)   conn.className   = 'stage-connector filled';
      if (status) { status.textContent = 'Done'; status.className = 'stage-status done'; }
    } else if (i === stage) {
      // Active
      if (node)   node.className   = 'stage-node active';
      if (conn)   conn.className   = 'stage-connector';
      if (status) {
        status.textContent = (stage === HYDRATE_TOTAL - 1) ? 'Complete' : 'Processing…';
        status.className   = 'stage-status active';
      }
    } else {
      // Pending
      if (node)   node.className   = 'stage-node';
      if (conn)   conn.className   = 'stage-connector';
      if (status) { status.textContent = 'Waiting'; status.className = 'stage-status'; }
    }
  }
}

/**
 * Swap out the stage flow for the clean "Synapse Ready" confirmation panel.
 * Called after all hydration stages are complete and the AI has begun responding.
 */
function showConfirmPanel() {
  const wrap    = $('hydrate-stage-wrap');
  const confirm = $('confirm-panel');
  if (!wrap || !confirm) return;

  // Fade out stage flow
  wrap.style.transition = 'opacity 0.35s ease';
  wrap.style.opacity    = '0';

  setTimeout(() => {
    wrap.style.display    = 'none';
    // Show confirmation panel and re-trigger its CSS animation
    confirm.style.display = 'flex';
    confirm.style.animation = 'none';
    void confirm.offsetHeight; // force reflow
    confirm.style.animation = '';
  }, 370);
}
