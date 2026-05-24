// Content script for Synapse Extension
console.log("[Synapse] Injector content script initialized.");

// Global selectors for supported chat interfaces
const SELECTORS = {
  chatgpt: {
    input: '#prompt-textarea',
    inputWrapper: '#prompt-textarea',
    assistantBubble: 'div[data-message-author-role="assistant"]'
  },
  claude: {
    input: 'div[contenteditable="true"]',
    inputWrapper: '.flex.flex-col.relative.w-full',
    assistantBubble: '.font-claude-message'
  },
  gemini: {
    input: 'div[contenteditable="true"]',
    inputWrapper: '.input-area',
    assistantBubble: 'message-content[author="assistant"]'
  }
};

let currentPlatform = null;

// Determine platform based on URL
function detectPlatform() {
  const url = window.location.href;
  if (url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('gemini.google.com')) return 'gemini';
  return null;
}

// Injects Synapse control button into LLM input wrapper
function injectLauncherButton() {
  currentPlatform = detectPlatform();
  if (!currentPlatform) return;

  const config = SELECTORS[currentPlatform];
  const inputEl = document.querySelector(config.input);
  
  if (!inputEl) return;
  
  // Check if button is already injected
  if (document.querySelector('.synapse-launcher-btn')) return;

  console.log("[Synapse] Injected text area detected. Injecting control menu...");

  // Create button structure
  const btn = document.createElement('button');
  btn.className = 'synapse-launcher-btn';
  btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #8b5cf6;"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;
  
  // Apply vanilla styles directly to prevent LLM site CSS pollution
  const platformPositions = {
    chatgpt: { right: '56px', bottom: '12px' },
    claude: { right: '68px', bottom: '16px' },
    gemini: { right: '92px', bottom: '10px' }
  };

  const pos = platformPositions[currentPlatform] || { right: '16px', bottom: '12px' };

  Object.assign(btn.style, {
    position: 'absolute',
    right: pos.right,
    bottom: pos.bottom,
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: '#0c0d16',
    border: '1px solid rgba(139, 92, 246, 0.6)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999',
    boxShadow: '0 0 8px rgba(139, 92, 246, 0.3)',
    transition: 'all 0.2s ease-in-out'
  });

  // Remove the left padding modification since we are on the right side now
  inputEl.style.paddingRight = '120px';

  // Attach button click behavior to launch panel
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSynapsePanel();
  });

  // Inject into DOM relative to input wrapper
  const targetParent = inputEl.parentElement;
  if (targetParent) {
    targetParent.style.position = 'relative';
    targetParent.appendChild(btn);
  }
}

// Injects floating selection menu for saved memory capsules
function toggleSynapsePanel() {
  let panel = document.querySelector('.synapse-injection-panel');
  if (panel) {
    panel.remove();
    return;
  }

  panel = document.createElement('div');
  panel.className = 'synapse-injection-panel';
  
  Object.assign(panel.style, {
    position: 'absolute',
    bottom: '50px',
    width: '320px',
    maxHeight: '300px',
    backgroundColor: '#0c0d16',
    border: '1px solid rgba(139, 92, 246, 0.4)',
    borderRadius: '12px',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.6)',
    zIndex: '10000',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    color: '#f3f4f6',
    overflowY: 'auto'
  });

  // Add search header
  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px;">
      <span style="font-size:12px; font-weight:600; color:#c084fc;">Select Synapse Capsule</span>
      <button class="synapse-close-panel" style="background:none; border:none; color:#9ca3af; cursor:pointer; font-size:12px;">Close</button>
    </div>
    <input type="text" class="synapse-panel-search" placeholder="Search local index..." style="width:100%; background:#05050a; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px; font-size:11px; color:#fff; outline:none;" />
    <div class="synapse-capsules-list" style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto; margin-top:4px;">
      <span style="font-size:11px; color:#6b7280; text-align:center; padding:12px 0;">Loading local database...</span>
    </div>
  `;

  document.body.appendChild(panel);

  // Position relative to launcher button
  const launcher = document.querySelector('.synapse-launcher-btn');
  if (launcher) {
    const rect = launcher.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.right = `${window.innerWidth - rect.right}px`;
    panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  }

  // Bind close buttons
  panel.querySelector('.synapse-close-panel').addEventListener('click', () => panel.remove());

  // Search logic
  const searchInput = panel.querySelector('.synapse-panel-search');
  searchInput.addEventListener('input', (e) => {
    fetchCapsules(e.target.value);
  });

  // Initial load
  fetchCapsules();
}

// Fetches capsules from background IndexedDB store
function fetchCapsules(query = '') {
  chrome.runtime.sendMessage({ action: 'getCapsules', query }, (response) => {
    const listContainer = document.querySelector('.synapse-capsules-list');
    if (!listContainer) return;

    if (!response || response.length === 0) {
      listContainer.innerHTML = `<span style="font-size:11px; color:#6b7280; text-align:center; padding:12px 0;">No capsules found.</span>`;
      return;
    }

    listContainer.innerHTML = response.map(cap => `
      <div class="synapse-item" data-id="${cap.id}" style="padding:8px; border:1px solid rgba(255,255,255,0.05); border-radius:6px; background:#06060c; cursor:pointer; display:flex; flex-direction:column; transition:background 0.2s;">
        <span style="font-size:11px; font-weight:600; color:#e5e7eb;">${cap.topic}</span>
        <span style="font-size:9px; color:#9ca3af; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cap.summary}</span>
      </div>
    `).join('');

    // Attach click events
    listContainer.querySelectorAll('.synapse-item').forEach(item => {
      item.addEventListener('click', () => {
        const capId = item.getAttribute('data-id');
        const selected = response.find(c => c.id === capId);
        if (selected) {
          injectIntoPrompt(selected);
          document.querySelector('.synapse-injection-panel').remove();
        }
      });
    });
  });
}

// Injects selected capsule prompt structure into DOM input text
function injectIntoPrompt(capsule) {
  const config = SELECTORS[detectPlatform()];
  const inputEl = document.querySelector(config.input);
  if (!inputEl) return;

  const codeSection = capsule.codeSkeleton ? `Structural Layout:\n${capsule.codeSkeleton}\n` : '';
  const fullContentSection = capsule.fullContent ? `Full Code/Text Context:\n${capsule.fullContent}\n` : '';

  const injectionText = `[SYNAPSE CAPSULE: ${capsule.topic}]\n` +
    `Summary: ${capsule.summary}\n` +
    codeSection +
    fullContentSection +
    `[Continue flow based on this context]\n\n`;

  if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
    inputEl.value = injectionText + inputEl.value;
  } else {
    // Contenteditable fields (Claude, Gemini)
    inputEl.innerText = injectionText + inputEl.innerText;
  }
  
  // Dispatch events to trigger LLM website React framework state updates
  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// Injects Hover Smart Copy utilities on assistant bubbles
function injectSmartCopyButtons() {
  currentPlatform = detectPlatform();
  if (!currentPlatform) return;

  // Broad selector matching ChatGPT, Claude, and Gemini assistant response containers
  const assistantSelectors = [
    'message-content',
    'g3-model-response',
    '.model-response',
    'div[data-message-author-role="assistant"]',
    '.font-claude-message',
    '[data-testid="assistant-message"]',
    '.message-content'
  ];

  const bubbles = document.querySelectorAll(assistantSelectors.join(', '));

  bubbles.forEach(bubble => {
    if (bubble.querySelector('.synapse-copy-hook')) return;

    // Create custom floating container
    const hook = document.createElement('div');
    hook.className = 'synapse-copy-hook';
    hook.innerHTML = `<button style="background:#8b5cf6; border:none; color:white; font-size:10px; font-weight:500; border-radius:4px; padding:3px 6px; cursor:pointer; display:flex; align-items:center; gap:3px; transition: background 0.2s;">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      Smart Copy
    </button>`;

    Object.assign(hook.style, {
      display: 'inline-flex',
      marginLeft: '8px',
      verticalAlign: 'middle'
    });

    hook.querySelector('button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const fullText = bubble.innerText.replace("Smart Copy", "").trim();
      chrome.runtime.sendMessage({
        action: 'createCapsule',
        topic: `Captured from ${currentPlatform}`,
        content: fullText
      }, (res) => {
        alert("Synapse Edge-AI summarized and registered this context block locally! Available now in your Vector Vault.");
      });
    });

    // Injects relative to assistant message containers
    const actionBarSelectors = [
      '.actions-container',
      '.action-buttons',
      '.message-actions-container',
      'message-actions',
      '.flex.justify-between',
      '.action-buttons-container'
    ];
    
    let actionBar = null;
    for (const sel of actionBarSelectors) {
      actionBar = bubble.querySelector(sel);
      if (actionBar) break;
    }
    
    if (actionBar) {
      actionBar.appendChild(hook);
    } else {
      bubble.appendChild(hook);
    }
  });
}

// Poll DOM state
setInterval(() => {
  injectLauncherButton();
  injectSmartCopyButtons();
}, 2000);
