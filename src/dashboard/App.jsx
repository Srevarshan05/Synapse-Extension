import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Overview from './components/Overview.jsx';
import CapsuleList from './components/CapsuleList.jsx';
import TrashView from './components/TrashView.jsx';
import ImportView from './components/ImportView.jsx';
import ExportView from './components/ExportView.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import { Zap } from 'lucide-react';
import {
  getCapsuleList,
  getStorageUsage,
  getActiveCapsule,
  deleteCapsule,
  pinCapsule,
  normalizeCapsule,
  getSetting,
  setSetting,
  validateStoragePath,
} from './bridge.js';

// ─── Platform metadata ───────────────────────────────────────────────────────
export const PLATFORM_COLORS = {
  chatgpt:    '#16a34a', // Green 600
  claude:     '#d97706', // Amber 600
  gemini:     '#2563eb', // Blue 600
  deepseek:   '#7c3aed',
  kimi:       '#06b6d4',
  grok:       '#e11d48',
  copilot:    '#0078d4',
  perplexity: '#20b2aa',
  poe:        '#6366f1',
  openrouter: '#f97316',
  mistral:    '#e85d04',
  qwen:       '#16a34a',
};

export const PLATFORM_NAMES = {
  chatgpt:    'ChatGPT',
  claude:     'Claude',
  gemini:     'Gemini',
  deepseek:   'DeepSeek',
  kimi:       'Kimi',
  grok:       'Grok',
  copilot:    'Copilot',
  perplexity: 'Perplexity',
  poe:        'Poe',
  openrouter: 'OpenRouter',
  mistral:    'Mistral',
  qwen:       'Qwen',
};

export const PLATFORM_EMOJI = {
  chatgpt:    '🤖',
  claude:     '🧠',
  gemini:     '✨',
  deepseek:   '🔭',
  kimi:       '🌊',
  grok:       '⚡',
  copilot:    '🪁',
  perplexity: '🔍',
  poe:        '🎭',
  openrouter: '🛣️',
  mistral:    '🌬️',
  qwen:       '🐉',
};

// ─── Toast system ────────────────────────────────────────────────────────────
let _toastSetters = [];
export function showToast(msg, type = 'info') {
  _toastSetters.forEach(fn => fn(prev => [...prev, { id: Date.now() + Math.random(), msg, type }]));
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    _toastSetters.push(setToasts);
    return () => { _toastSetters = _toastSetters.filter(f => f !== setToasts); };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(1));
    }, 3500);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="synapse-toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`synapse-toast synapse-toast--${t.type}`}>
          {t.type === 'success' && '✓'}
          {t.type === 'error' && '✕'}
          {t.type === 'info' && 'ℹ'}
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─── Active Capsule Banner ───────────────────────────────────────────────────
function ActiveCapsuleBanner({ capsule }) {
  if (!capsule) return null;
  const color = PLATFORM_COLORS[capsule.platform] || '#8b5cf6';
  return (
    <div className="synapse-active-banner">
      <span className="synapse-active-banner__dot" />
      <span className="synapse-active-banner__label">Active session:</span>
      <span className="synapse-active-banner__name">{capsule.title}</span>
      <span
        className="synapse-active-banner__platform synapse-platform-badge"
        style={{ color, borderColor: color + '40', background: color + '18' }}
      >
        <span className="synapse-platform-dot" style={{ background: color }} />
        {PLATFORM_NAMES[capsule.platform] || capsule.platform}
      </span>
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('overview');
  const [capsules, setCapsules] = useState([]);
  const [storageInfo, setStorageInfo] = useState(null);
  const [activeCapsule, setActiveCapsule] = useState(null);
  const [loading, setLoading] = useState(true);

  // Storage configuration state
  const [hasStoragePathSet, setHasStoragePathSet] = useState(true);
  const [checkingStoragePath, setCheckingStoragePath] = useState(true);
  const [proposedStoragePath, setProposedStoragePath] = useState('');
  const [storagePathInputValue, setStoragePathInputValue] = useState('');
  const [storageLimitInputValue, setStorageLimitInputValue] = useState(500); // default to 500 MB
  const [pathSetupError, setPathSetupError] = useState('');
  const [initializingPath, setInitializingPath] = useState(false);

  // Splash Screen States
  const [showSplash, setShowSplash] = useState(true);
  const [fadeSplash, setFadeSplash] = useState(false);

  // Theme States
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('synapse-theme') || 'dark';
  });

  const handleToggleTheme = () => {
    setTheme(prev => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem('synapse-theme', next);
      setSetting('synapse-theme', next).catch(err => {
        console.error('[Synapse] Failed to save theme setting to SQLite:', err);
      });
      return next;
    });
  };

  // Check settings on mount
  useEffect(() => {
    async function checkSettings() {
      try {
        const themeRes = await getSetting('synapse-theme');
        if (themeRes.success && themeRes.value) {
          setTheme(themeRes.value);
          localStorage.setItem('synapse-theme', themeRes.value);
        } else {
          setTheme('dark');
          localStorage.setItem('synapse-theme', 'dark');
          setSetting('synapse-theme', 'dark').catch(() => {});
        }
      } catch (err) {
        console.error('[Synapse] Failed to load theme setting on mount:', err);
      }

      try {
        const res = await getSetting('storage_path');
        if (res.success && res.value && res.value.trim() !== '') {
          setHasStoragePathSet(true);
        } else {
          setHasStoragePathSet(false);
          // Query backend status to get its standard/default storage path
          try {
            const statusRes = await fetch('http://127.0.0.1:3742/status');
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              if (statusData.default_storage_path) {
                const def = statusData.default_storage_path + '\\Synapse-Storage';
                setProposedStoragePath(def);
                setStoragePathInputValue(def);
              }
            }
          } catch (statusErr) {
            setProposedStoragePath('C:\\Synapse-Storage');
            setStoragePathInputValue('C:\\Synapse-Storage');
          }
        }
      } catch (err) {
        console.error('[Synapse] Error checking storage path on mount:', err);
        setHasStoragePathSet(false);
      } finally {
        setCheckingStoragePath(false);
      }
    }
    checkSettings();
  }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeSplash(true), 2400);
    const removeTimer = setTimeout(() => setShowSplash(false), 2900);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [capsulesRes, storageRes, activeRes] = await Promise.all([
        getCapsuleList(),
        getStorageUsage(),
        getActiveCapsule(),
      ]);
      if (capsulesRes.success) setCapsules((capsulesRes.capsules || []).map(normalizeCapsule));
      if (storageRes.success) setStorageInfo(storageRes);
      if (activeRes.success) setActiveCapsule(activeRes.capsule ? normalizeCapsule(activeRes.capsule) : null);
    } catch (err) {
      console.error('[Synapse] Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleDelete = useCallback(async (id) => {
    try {
      const res = await deleteCapsule(id);
      if (res.success) {
        setCapsules(prev => prev.filter(c => c.id !== id));
        showToast('Synapse moved to Trash', 'success');
      } else {
        showToast(res.error || 'Delete failed', 'error');
      }
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  }, []);

  const handlePin = useCallback(async (id, pinned) => {
    try {
      const res = await pinCapsule(id, pinned);
      if (res.success) {
        setCapsules(prev => prev.map(c => c.id === id ? { ...c, pinned } : c));
        showToast(pinned ? 'Synapse pinned' : 'Synapse unpinned', 'success');
      }
    } catch (err) {
      showToast('Pin failed', 'error');
    }
  }, []);

  const handleImportSuccess = useCallback((newCapsule) => {
    setCapsules(prev => [newCapsule, ...prev]);
    loadAll();
  }, [loadAll]);

  const handleNavigate = (newView) => {
    setView(newView);
  };

  const renderView = () => {
    switch (view) {
      case 'overview':
        return (
          <Overview
            capsules={capsules}
            storageInfo={storageInfo}
            loading={loading}
            onNavigate={handleNavigate}
            onDelete={handleDelete}
            onPin={handlePin}
          />
        );
      case 'capsules':
        return (
          <CapsuleList
            capsules={capsules}
            loading={loading}
            onDelete={handleDelete}
            onPin={handlePin}
            onRefresh={loadAll}
          />
        );
      case 'trash':
        return (
          <TrashView onRefresh={loadAll} />
        );
      case 'import':
        return <ImportView onImportSuccess={handleImportSuccess} />;
      case 'export':
        return <ExportView capsules={capsules} />;
      case 'settings':
        return <SettingsPanel onClearAll={() => { setCapsules([]); loadAll(); }} />;
      default:
        return null;
    }
  };

  if (!checkingStoragePath && !hasStoragePathSet) {
    const handleInitializePath = async (e) => {
      e?.preventDefault();
      if (!storagePathInputValue.trim()) {
        setPathSetupError('Path cannot be empty');
        return;
      }
      setInitializingPath(true);
      setPathSetupError('');
      try {
        const validateRes = await validateStoragePath(storagePathInputValue);
        if (validateRes.success) {
          const saveRes = await setSetting('storage_path', storagePathInputValue);
          const saveLimitRes = await setSetting('storage_limit_mb', String(storageLimitInputValue));
          if (saveRes.success && saveLimitRes.success) {
            setHasStoragePathSet(true);
            showToast('Local PC Storage initialized successfully!', 'success');
            loadAll();
          } else {
            setPathSetupError(saveRes.error || saveLimitRes.error || 'Failed to save setting');
          }
        } else {
          setPathSetupError(validateRes.error || 'The selected path is not writable. Please check permissions or select another folder.');
        }
      } catch (err) {
        setPathSetupError(err.message || 'Validation error');
      } finally {
        setInitializingPath(false);
      }
    };

    return (
      <div className={`synapse-app ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ position: 'relative', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Decorative background blobs */}
        <div style={{
          position: 'absolute',
          top: '-10%',
          left: '-10%',
          width: '50%',
          height: '50%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-10%',
          right: '-10%',
          width: '50%',
          height: '50%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(168, 85, 247, 0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0
        }} />

        <div className="synapse-card" style={{ maxWidth: 500, width: '90%', padding: '32px', borderRadius: 20, zIndex: 1, boxShadow: 'var(--shadow-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, var(--accent), var(--accent2))', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-glow)' }}>
              <Zap size={22} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>Configure Local Storage</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Primary PC Storage Setup</p>
            </div>
          </div>

          <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: '1.55', marginBottom: 24 }}>
            Synapse runs completely locally on your PC. To preserve and manage your continuity sessions, select a custom local directory and set your storage size allocation.
          </div>

          <form onSubmit={handleInitializePath} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Storage Directory Path</label>
              <input
                type="text"
                placeholder="e.g. C:\Synapse-Storage"
                value={storagePathInputValue}
                onChange={e => {
                  setStoragePathInputValue(e.target.value);
                  setPathSetupError('');
                }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontFamily: 'monospace',
                  transition: 'border var(--transition)'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Memory Allocation Limit</label>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                  {storageLimitInputValue} MB
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="5000"
                step="50"
                value={storageLimitInputValue}
                onChange={e => setStorageLimitInputValue(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'var(--border)'
                }}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Set max storage size allocated for local dialogue histories and portable synapses.
              </span>
            </div>

            {pathSetupError && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: 'rgba(239, 68, 68, 0.06)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 8, color: 'var(--error)', fontSize: '0.8rem' }}>
                <span style={{ fontWeight: 'bold' }}>✕</span>
                <span>{pathSetupError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="synapse-btn synapse-btn--secondary"
                onClick={() => {
                  setStoragePathInputValue(proposedStoragePath);
                  setPathSetupError('');
                }}
                style={{ flexGrow: 1, padding: '10px 0', fontSize: '0.82rem', justifyContent: 'center' }}
              >
                Use Default Path
              </button>
              <button
                type="submit"
                className="synapse-btn synapse-btn--primary"
                disabled={initializingPath}
                style={{ flexGrow: 2, padding: '10px 0', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                {initializingPath ? (
                  <>
                    <div className="synapse-spinner synapse-spinner--sm" /> Initializing...
                  </>
                ) : (
                  <>Initialize Synapse</>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`synapse-app ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ position: 'relative', overflow: 'hidden' }}>
      {showSplash && (
        <div className={`synapse-splash ${fadeSplash ? 'fade-out' : ''}`}>
          <div className="synapse-splash-logo-container">
            <div className="synapse-splash-logo">
              <Zap size={36} color="white" strokeWidth={2.5} />
            </div>
            <h1 className="synapse-splash-title">Synapse</h1>
            <div className="synapse-splash-animating-text">
              Context Switching made easier
            </div>
          </div>
        </div>
      )}

      {/* Premium Light SaaS Mesh Decorative Blobs */}
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '-10%',
        width: '40%',
        height: '40%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99, 102, 241, 0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-10%',
        right: '-10%',
        width: '40%',
        height: '40%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(168, 85, 247, 0.05) 0%, transparent 70%)',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <Sidebar 
        activeView={view} 
        onNavigate={handleNavigate} 
        capsuleCount={capsules.length} 
        theme={theme} 
        onToggleTheme={handleToggleTheme} 
      />
      <div className="synapse-main" style={{ zIndex: 1, position: 'relative' }}>
        <ActiveCapsuleBanner capsule={activeCapsule} />
        <div className="synapse-content">
          {renderView()}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
