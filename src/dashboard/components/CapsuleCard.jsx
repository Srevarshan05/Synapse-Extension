import React, { useState } from 'react';
import { Pin, Trash2, Shield, Lock, CheckCircle, Zap, Eye, Loader, Calendar, MessageSquare, HardDrive, Check } from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_NAMES, PLATFORM_EMOJI } from '../App.jsx';
import { injectCapsule } from '../bridge.js';

function formatTimeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CompletenessBar({ value }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  const color = pct >= 90 ? '#16a34a' : pct >= 70 ? '#d97706' : '#dc2626';
  return (
    <div className="synapse-capsule-card__completeness" style={{ marginTop: 8 }}>
      <div className="synapse-completeness-label" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span>Extraction integrity</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div className="synapse-completeness-bar" style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
        <div
          className="synapse-completeness-bar__fill"
          style={{ width: `${pct}%`, background: color, height: '100%' }}
        />
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, onConfirm, onCancel }) {
  return (
    <div className="synapse-modal-overlay" onClick={onCancel}>
      <div className="synapse-modal" onClick={e => e.stopPropagation()}>
        <div className="synapse-modal__title" style={{ color: 'var(--error)' }}>
          {title}
        </div>
        <div className="synapse-modal__body" style={{ color: 'var(--text-secondary)' }}>
          {body}
        </div>
        <div className="synapse-modal__actions">
          <button className="synapse-btn synapse-btn--secondary synapse-btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button className="synapse-btn synapse-btn--danger synapse-btn--sm" onClick={onConfirm}>
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
}



export default function CapsuleCard({ capsule, onDelete, onPin, onView, isSelected, onSelect }) {
  const [showConfirm, setShowConfirm]       = useState(false);

  const color = PLATFORM_COLORS[capsule.platform] || '#6366f1';
  const emoji = PLATFORM_EMOJI[capsule.platform]  || '🤖';
  const name  = PLATFORM_NAMES[capsule.platform]  || capsule.platform;

  const completeness = capsule.completeness ?? 100;

  return (
    <>
      <div
        className={`vault-card ${isSelected ? 'selected' : ''}`}
        style={{
          ...(capsule.pinned ? { borderLeft: `3px solid ${color}`, paddingLeft: 13 } : {}),
          ...(isSelected ? { borderColor: `${color}`, boxShadow: `0 8px 30px ${color}12, inset 0 0 0 1px ${color}20` } : {})
        }}
      >
        <div className="vault-card-body">
          {/* Card Header */}
          <div className="vault-card-header" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Custom Checkbox */}
            {onSelect && (
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(capsule.id);
                }}
                className={`custom-checkbox ${isSelected ? 'checked' : ''}`}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '5px',
                  border: `2px solid ${isSelected ? color : 'rgba(15, 23, 42, 0.2)'}`,
                  background: isSelected ? color : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                  marginRight: 2,
                  flexShrink: 0
                }}
                title={isSelected ? "Deselect synapse" : "Select synapse"}
              >
                {isSelected && <Check size={11} color="#ffffff" strokeWidth={3} />}
              </div>
            )}
            
            <div 
              className="vault-card-title" 
              style={{ flexGrow: 1 }}
            >
              {capsule.title}
            </div>

            {/* Pin Badge */}
            {capsule.pinned && (
              <Pin size={12} fill={color} color={color} style={{ marginLeft: 'auto' }} />
            )}
          </div>

          {/* Badges Section */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
            <span
              className="badge"
              style={{ color, borderColor: color + '40', background: color + '12' }}
            >
              {name}
            </span>
            <span className="badge" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              {capsule.captureLevel}
            </span>
            {capsule.completeness < 100 && (
              <span className="badge" style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#ef4444' }}>
                partial
              </span>
            )}
          </div>

          {/* Preview Snippet */}
          <div className="vault-card-snippet" style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {capsule.summary || 'No preview snippet available.'}
          </div>

          {/* Completeness meter */}
          <CompletenessBar value={completeness} />

          {/* Card Meta Row */}
          <div className="vault-card-meta" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10, 
            marginTop: 12, 
            fontSize: '0.78rem', 
            color: 'var(--text-muted)',
            flexWrap: 'wrap'
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} />
              {formatDate(capsule.createdAt)}
            </span>
            <span style={{ color: 'rgba(15, 23, 42, 0.12)' }}>|</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MessageSquare size={12} />
              {capsule.messagesCount} turns
            </span>
            <span style={{ color: 'rgba(15, 23, 42, 0.12)' }}>|</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <HardDrive size={12} />
              {(capsule.sizeBytes / 1024).toFixed(1)} KB
            </span>
          </div>

          {/* Footer Card Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Context session is securely synchronized */}
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }}></span>
                Synced to Extension
              </span>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="synapse-icon-btn"
                title={capsule.pinned ? 'Unpin' : 'Pin'}
                onClick={() => onPin(capsule.id, !capsule.pinned)}
                style={{ 
                  width: 28, 
                  height: 28, 
                  borderRadius: 6, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  background: capsule.pinned ? `${color}12` : 'rgba(255, 255, 255, 0.5)',
                  border: `1px solid ${capsule.pinned ? `${color}30` : 'rgba(15, 23, 42, 0.06)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Pin size={12} fill={capsule.pinned ? color : 'none'} color={capsule.pinned ? color : 'var(--text-muted)'} />
              </button>
              
              <button
                className="synapse-icon-btn"
                title="Move to Trash"
                onClick={() => setShowConfirm(true)}
                style={{ 
                  width: 28, 
                  height: 28, 
                  borderRadius: 6, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  color: '#ef4444',
                  background: 'rgba(239, 68, 68, 0.05)',
                  border: '1px solid rgba(239, 68, 68, 0.12)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete/Trash Confirm Modal */}
      {showConfirm && (
        <ConfirmModal
          title="Move Synapse to Trash?"
          body={`"${capsule.title}" will be moved to the Trash. You can restore it anytime within 30 days.`}
          onConfirm={() => { setShowConfirm(false); onDelete(capsule.id); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
