import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Zap,
  Shield,
  Lock,
  Trash2,
  AlertTriangle,
  RotateCcw,
  HardDrive,
} from 'lucide-react';
import { getSetting, setSetting, clearAllCapsules } from '../bridge.js';
import { showToast } from '../App.jsx';

// ─── Toggle Component ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="synapse-toggle" style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => !disabled && onChange(e.target.checked)}
        disabled={disabled}
      />
      <div className="synapse-toggle__track" />
      <div className="synapse-toggle__thumb" />
    </label>
  );
}

// ─── Radio Group ──────────────────────────────────────────────────────────────
function RadioGroup({ options, value, onChange }) {
  return (
    <div className="synapse-radio-group">
      {options.map(opt => (
        <div
          key={opt.value}
          className={`synapse-radio-opt${value === opt.value ? ' synapse-radio-opt--active' : ''}`}
          onClick={() => onChange(opt.value)}
          role="radio"
          aria-checked={value === opt.value}
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && onChange(opt.value)}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}

// ─── Settings Row ─────────────────────────────────────────────────────────────
function SettingRow({ title, desc, control }) {
  return (
    <div className="synapse-settings__row">
      <div className="synapse-settings__row-label">
        <div className="synapse-settings__row-title">{title}</div>
        {desc && <div className="synapse-settings__row-desc">{desc}</div>}
      </div>
      <div className="synapse-settings__row-ctrl">{control}</div>
    </div>
  );
}

// ─── Confirm Clear Modal ──────────────────────────────────────────────────────
function ConfirmClearModal({ onConfirm, onCancel }) {
  return (
    <div className="synapse-modal-overlay" onClick={onCancel}>
      <div className="synapse-modal" onClick={e => e.stopPropagation()}>
        <div className="synapse-modal__title" style={{ color: 'var(--error)' }}>
          ⚠ Clear All Synapses?
        </div>
        <div className="synapse-modal__body">
          This will permanently delete <strong>all</strong> captured synapses and context data.
          This action cannot be undone. Export your data first if needed.
        </div>
        <div className="synapse-modal__actions">
          <button className="synapse-btn synapse-btn--secondary synapse-btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button className="synapse-btn synapse-btn--danger synapse-btn--sm" onClick={onConfirm}>
            <Trash2 size={13} /> Clear Everything
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
export default function SettingsPanel({ onClearAll }) {
  const [captureLevel, setCaptureLevel]         = useState('standard');
  const [redactionEnabled, setRedactionEnabled] = useState(false);
  const [encryptionMode, setEncryptionMode]     = useState('auto');
  const [autoPin, setAutoPin]                   = useState(false);
  const [showClearModal, setShowClearModal]      = useState(false);
  const [clearing, setClearing]                 = useState(false);
  const [loading, setLoading]                   = useState(true);
  const [saving, setSaving]                     = useState({});

  // Storage path settings states
  const [storagePathInput, setStoragePathInput] = useState('');
  const [storageLimitInput, setStorageLimitInput] = useState(500);
  const [pathValidationError, setPathValidationError] = useState('');
  const [updatingPath, setUpdatingPath] = useState(false);

  // ── Load settings on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [capRes, redRes, encRes, pinRes, pathRes, limitRes] = await Promise.all([
          getSetting('captureLevel'),
          getSetting('redactionEnabled'),
          getSetting('encryptionMode'),
          getSetting('autoPin'),
          getSetting('storage_path'),
          getSetting('storage_limit_mb'),
        ]);
        if (capRes.success && capRes.value != null) setCaptureLevel(capRes.value);
        if (redRes.success && redRes.value != null) setRedactionEnabled(!!redRes.value);
        if (encRes.success && encRes.value != null) setEncryptionMode(encRes.value);
        if (pinRes.success && pinRes.value != null) setAutoPin(!!pinRes.value);
        if (pathRes.success && pathRes.value != null) setStoragePathInput(pathRes.value);
        if (limitRes.success && limitRes.value != null) setStorageLimitInput(parseInt(limitRes.value, 10) || 500);
      } catch (err) {
        console.error('[Synapse] Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpdateStoragePath = async () => {
    if (!storagePathInput.trim()) {
      setPathValidationError('Path cannot be empty');
      return;
    }
    setUpdatingPath(true);
    setPathValidationError('');
    try {
      const { validateStoragePath } = await import('../bridge.js');
      const valRes = await validateStoragePath(storagePathInput);
      if (valRes.success) {
        const saveRes = await setSetting('storage_path', storagePathInput);
        if (saveRes.success) {
          showToast('Storage directory updated successfully!', 'success');
        } else {
          setPathValidationError(saveRes.error || 'Failed to save path setting');
        }
      } else {
        setPathValidationError(valRes.error || 'Path is not writable. Please check folder permissions.');
      }
    } catch (err) {
      setPathValidationError(err.message || 'Validation error');
    } finally {
      setUpdatingPath(false);
    }
  };

  // ── Persist a setting ─────────────────────────────────────────────────────
  const saveSetting = useCallback(async (key, value) => {
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      const res = await setSetting(key, value);
      if (res.success) {
        showToast(`Setting updated`, 'success');
      } else {
        showToast('Failed to save setting', 'error');
      }
    } catch (err) {
      showToast('Error saving setting', 'error');
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, []);

  const handleCaptureLevelChange = (v) => {
    setCaptureLevel(v);
    saveSetting('captureLevel', v);
  };

  const handleRedactionChange = (v) => {
    setRedactionEnabled(v);
    saveSetting('redactionEnabled', v);
  };

  const handleEncryptionModeChange = (v) => {
    setEncryptionMode(v);
    saveSetting('encryptionMode', v);
  };

  const handleAutoPinChange = (v) => {
    setAutoPin(v);
    saveSetting('autoPin', v);
  };

  const handleClearAll = async () => {
    setClearing(true);
    try {
      const res = await clearAllCapsules();
      if (res.success) {
        showToast('All synapses cleared', 'success');
        onClearAll?.();
      } else {
        showToast('Clear failed', 'error');
      }
    } catch (err) {
      showToast('Clear failed', 'error');
    } finally {
      setClearing(false);
      setShowClearModal(false);
    }
  };

  if (loading) {
    return (
      <div className="synapse-loading-center">
        <div className="synapse-spinner synapse-spinner--lg" />
      </div>
    );
  }

  return (
    <>
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Settings</div>
        <div className="synapse-page-header__sub">
          Configure Synapse v3 behaviour and security preferences
        </div>
      </div>

      <div className="synapse-settings">
        {/* Capture Settings */}
        <div className="synapse-card synapse-settings__section">
          <div className="synapse-settings__section-title">
            <Zap size={13} color="var(--accent)" />
            Capture
          </div>

          <SettingRow
            title="Capture Level"
            desc="Controls how deeply Synapse extracts context from conversations."
            control={
              <RadioGroup
                options={[
                  { value: 'fast',     label: 'Fast' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'deep',     label: 'Deep' },
                ]}
                value={captureLevel}
                onChange={handleCaptureLevelChange}
              />
            }
          />

          <SettingRow
            title="Auto-pin new synapses"
            desc="Automatically pin every newly captured synapse."
            control={
              <Toggle
                checked={autoPin}
                onChange={handleAutoPinChange}
              />
            }
          />
        </div>

        {/* Security Settings */}
        <div className="synapse-card synapse-settings__section">
          <div className="synapse-settings__section-title">
            <Shield size={13} color="var(--accent)" />
            Security & Privacy
          </div>

          <SettingRow
            title="Redact Sensitive Data"
            desc="Automatically detect and mask emails, phone numbers, API keys, and other PII in captured context."
            control={
              <Toggle
                checked={redactionEnabled}
                onChange={handleRedactionChange}
              />
            }
          />

          <SettingRow
            title="Encryption Mode"
            desc="Protect stored synapse data with encryption."
            control={
              <select
                className="synapse-select"
                value={encryptionMode}
                onChange={e => handleEncryptionModeChange(e.target.value)}
              >
                <option value="auto">Auto (device key)</option>
                <option value="passphrase">Passphrase</option>
                <option value="none">None</option>
              </select>
            }
          />

          {encryptionMode === 'passphrase' && (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--warning)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}>
              <Lock size={14} style={{ marginTop: 1, flexShrink: 0 }} />
              Passphrase encryption is configured via the extension popup. Synapses encrypted with a
              passphrase cannot be imported without it.
            </div>
          )}
        </div>

        {/* Local Storage */}
        <div className="synapse-card synapse-settings__section">
          <div className="synapse-settings__section-title">
            <HardDrive size={13} color="var(--accent)" />
            Local PC Storage Location
          </div>

          <SettingRow
            title="Storage Directory"
            desc="The local directory path on this PC where all captured synapses are stored."
            control={
              <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: '400px', flexDirection: 'column' }}>
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <input
                    type="text"
                    className="synapse-input"
                    value={storagePathInput}
                    onChange={e => {
                      setStoragePathInput(e.target.value);
                      setPathValidationError('');
                    }}
                    style={{
                      flexGrow: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-input)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace'
                    }}
                  />
                  <button
                    className="synapse-btn synapse-btn--primary synapse-btn--sm"
                    onClick={handleUpdateStoragePath}
                    disabled={updatingPath}
                    style={{ flexShrink: 0 }}
                  >
                    {updatingPath ? 'Saving...' : 'Update'}
                  </button>
                </div>
                {pathValidationError && (
                  <div style={{ color: 'var(--error)', fontSize: '0.8rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>✕</span>
                    <span>{pathValidationError}</span>
                  </div>
                )}
              </div>
            }
          />

          <SettingRow
            title="Memory Limit Allocation"
            desc="Set the maximum storage size allocated for local dialogue histories and portable synapses."
            control={
              <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: '400px', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                    {storageLimitInput} MB
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="5000"
                  step="50"
                  value={storageLimitInput}
                  onChange={e => {
                    const newVal = parseInt(e.target.value, 10);
                    setStorageLimitInput(newVal);
                    saveSetting('storage_limit_mb', String(newVal));
                  }}
                  style={{
                    width: '100%',
                    accentColor: 'var(--accent)',
                    cursor: 'pointer',
                    height: '6px',
                    borderRadius: '3px',
                    background: 'var(--border)'
                  }}
                />
              </div>
            }
          />
        </div>

        {/* About */}
        <div className="synapse-card synapse-settings__section">
          <div className="synapse-settings__section-title">
            <Settings size={13} color="var(--accent)" />
            About
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Version', 'v4.0.0'],
              ['Schema Version', '4'],
              ['Supported Platforms', '12'],
              ['Storage Backend', 'Local PC Storage'],
            ].map(([k, v]) => (
              <div key={k} className="synapse-settings__row" style={{ padding: '10px 0' }}>
                <span className="synapse-settings__row-title" style={{ fontSize: 13 }}>{k}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="synapse-card synapse-danger-zone">
          <div className="synapse-danger-zone__title">
            <AlertTriangle size={13} style={{ display: 'inline', marginRight: 6 }} />
            Danger Zone
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="synapse-settings__row-title">Clear All Synapses</div>
              <div className="synapse-settings__row-desc">
                Permanently delete all captured synapses from storage. Cannot be undone.
              </div>
            </div>
            <button
              className="synapse-btn synapse-btn--danger synapse-btn--sm"
              onClick={() => setShowClearModal(true)}
              disabled={clearing}
              style={{ flexShrink: 0 }}
            >
              {clearing
                ? <><div className="synapse-spinner synapse-spinner--sm" /> Clearing…</>
                : <><Trash2 size={13} /> Clear All</>
              }
            </button>
          </div>

          <div className="synapse-divider" />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div className="synapse-settings__row-title">Reset Settings</div>
              <div className="synapse-settings__row-desc">
                Restore all settings to their factory defaults.
              </div>
            </div>
            <button
              className="synapse-btn synapse-btn--secondary synapse-btn--sm"
              onClick={async () => {
                await Promise.all([
                  setSetting('captureLevel', 'standard'),
                  setSetting('redactionEnabled', false),
                  setSetting('encryptionMode', 'auto'),
                  setSetting('autoPin', false),
                ]);
                setCaptureLevel('standard');
                setRedactionEnabled(false);
                setEncryptionMode('auto');
                setAutoPin(false);
                showToast('Settings reset to defaults', 'success');
              }}
              style={{ flexShrink: 0 }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
      </div>

      {showClearModal && (
        <ConfirmClearModal
          onConfirm={handleClearAll}
          onCancel={() => setShowClearModal(false)}
        />
      )}
    </>
  );
}
