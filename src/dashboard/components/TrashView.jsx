import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Search, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { getTrashList, restoreCapsule, purgeCapsule } from '../bridge.js';
import { PLATFORM_COLORS, PLATFORM_NAMES, PLATFORM_EMOJI, showToast } from '../App.jsx';

export default function TrashView({ onRefresh }) {
  const [trashList, setTrashList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeTargetId, setPurgeTargetId] = useState(null);
  const [batchPurge, setBatchPurge] = useState(false);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTrashList();
      if (res.success) {
        setTrashList(res.capsules || []);
      } else {
        showToast(res.error || 'Failed to query Trash Vault', 'error');
      }
    } catch (err) {
      showToast('Connection error', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  // Reset selections when trash list or loading state changes
  useEffect(() => {
    setSelectedIds([]);
  }, [trashList, loading]);

  const handleSelectToggle = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllToggle = () => {
    if (selectedIds.length === trashList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(trashList.map(c => c.id));
    }
  };

  const handleRestore = async (id, title) => {
    try {
      const res = await restoreCapsule(id);
      if (res.success) {
        setTrashList(prev => prev.filter(x => x.id !== id));
        showToast(`"${title}" restored successfully`, 'success');
        if (onRefresh) onRefresh();
      } else {
        showToast(res.error || 'Failed to restore', 'error');
      }
    } catch (err) {
      showToast('Restore failed', 'error');
    }
  };

  const handleBatchRestore = async () => {
    let successCount = 0;
    for (const id of selectedIds) {
      const cap = trashList.find(c => c.id === id);
      if (!cap) continue;
      try {
        const res = await restoreCapsule(id);
        if (res.success) successCount++;
      } catch (err) {
        console.error('Batch restore failed:', id, err);
      }
    }
    showToast(`Restored ${successCount} synapses!`, 'success');
    loadTrash();
    if (onRefresh) onRefresh();
  };

  const triggerPurge = (id) => {
    setPurgeTargetId(id);
    setBatchPurge(false);
    setShowPurgeConfirm(true);
  };

  const triggerBatchPurge = () => {
    setBatchPurge(true);
    setShowPurgeConfirm(true);
  };

  const confirmPurge = async () => {
    setShowPurgeConfirm(false);
    
    if (batchPurge) {
      let successCount = 0;
      for (const id of selectedIds) {
        try {
          const res = await purgeCapsule(id);
          if (res.success) successCount++;
        } catch (err) {
          console.error('Permanent purge failed:', id, err);
        }
      }
      showToast(`Permanently erased ${successCount} synapses from disk`, 'success');
      setSelectedIds([]);
    } else if (purgeTargetId) {
      const cap = trashList.find(c => c.id === purgeTargetId);
      try {
        const res = await purgeCapsule(purgeTargetId);
        if (res.success) {
          setTrashList(prev => prev.filter(x => x.id !== purgeTargetId));
          showToast(`"${cap?.title || 'Synapse'}" permanently deleted`, 'success');
        } else {
          showToast(res.error || 'Purge failed', 'error');
        }
      } catch (err) {
        showToast('Purge failed', 'error');
      }
      setPurgeTargetId(null);
    }
    loadTrash();
    if (onRefresh) onRefresh();
  };

  const getRemainingDays = (deletedAt) => {
    if (!deletedAt) return 30;
    const diff = Date.now() - deletedAt;
    const remainingDays = 30 - Math.floor(diff / (24 * 60 * 60 * 1000));
    return Math.max(0, remainingDays);
  };

  return (
    <div>
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Trash Vault</div>
        <div className="synapse-page-header__sub">
          Soft-deleted items are safely cached for 30 days before permanent erasure
        </div>
      </div>

      {/* Batch Actions Panel */}
      {selectedIds.length > 0 && (
        <div className="multi-actions-bar">
          <span className="multi-actions-label">
            {selectedIds.length} synapse{selectedIds.length !== 1 ? 's' : ''} in trash selected
          </span>
          <div className="multi-actions-buttons">
            <button 
              onClick={handleBatchRestore}
              className="synapse-btn synapse-btn--secondary synapse-btn--sm" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={14} /> Restore Selected
            </button>
            <button 
              onClick={triggerBatchPurge}
              className="synapse-btn synapse-btn--danger synapse-btn--sm" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> Purge Selected
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="synapse-capsule-list__toolbar">
        {trashList.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 8 }}>
            <input 
              type="checkbox" 
              checked={trashList.length > 0 && selectedIds.length === trashList.length}
              onChange={handleSelectAllToggle}
              className="selection-checkbox"
              style={{ marginTop: 0 }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Select All</span>
          </div>
        )}
        <div style={{ flexGrow: 1 }} />
        <button
          className="synapse-icon-btn"
          onClick={loadTrash}
          title="Refresh trash"
        >
          <RefreshCw size={15} style={loading ? { animation: 'spin 1.2s linear infinite' } : {}} />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--accent-purple)' }} />
        </div>
      )}

      {/* Empty Trash State */}
      {!loading && trashList.length === 0 && (
        <div className="synapse-empty" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: 48, borderRadius: 12 }}>
          <div className="synapse-empty__icon">
            <Trash2 size={28} color="var(--text-muted)" />
          </div>
          <div className="synapse-empty__title">Trash Vault is empty</div>
          <div className="synapse-empty__sub">
            Soft-deleted synapses will appear here for recovery.
          </div>
        </div>
      )}

      {/* Trash List */}
      {!loading && trashList.length > 0 && (
        <div className="synapse-capsule-list__grid" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {trashList.map(c => {
            const color = PLATFORM_COLORS[c.platform] || '#6366f1';
            const emoji = PLATFORM_EMOJI[c.platform] || '🤖';
            const remainingDays = getRemainingDays(c.deletedAt);
            const progressPct = (remainingDays / 30) * 100;
            
            return (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input 
                  type="checkbox" 
                  checked={selectedIds.includes(c.id)}
                  onChange={() => handleSelectToggle(c.id)}
                  className="selection-checkbox"
                />
                
                <div 
                  className="vault-card" 
                  style={{ flexGrow: 1, padding: 14, background: 'var(--card-bg)', borderColor: 'var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexGrow: 1 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
                      <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span>Deleted: {c.deletedAt ? new Date(c.deletedAt).toLocaleDateString() : 'Unknown'}</span>
                        <span>•</span>
                        <span>{c.messagesCount} turns</span>
                        <span>•</span>
                        <span style={{ color: remainingDays < 5 ? '#ef4444' : '#d97706', fontWeight: 600 }}>
                          {remainingDays} days remaining
                        </span>
                      </div>
                      
                      {/* Gauge Indicator */}
                      <div className="cleanup-gauge" style={{ marginTop: 6, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden' }}>
                        <div 
                          style={{ 
                            width: `${progressPct}%`, 
                            background: remainingDays < 5 ? '#ef4444' : '#f59e0b', 
                            height: '100%' 
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* Action Panel */}
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        onClick={() => handleRestore(c.id, c.title)}
                        className="synapse-btn synapse-btn--secondary synapse-btn--sm"
                        style={{ padding: '6px 12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Restore synapse back to library"
                      >
                        <RotateCcw size={12} /> Restore
                      </button>
                      <button
                        onClick={() => triggerPurge(c.id)}
                        className="synapse-btn synapse-btn--danger synapse-btn--sm"
                        style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                        title="Permanently erase from disk"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Permanent Delete Warning Double-Check Dialog */}
      {showPurgeConfirm && (
        <div className="synapse-modal-overlay" onClick={() => setShowPurgeConfirm(false)}>
          <div className="synapse-modal" onClick={e => e.stopPropagation()}>
            <div className="synapse-modal__title" style={{ color: 'var(--error)' }}>
              ⚠ Permanently erase synapse(s)?
            </div>
            <div className="synapse-modal__body" style={{ color: 'var(--text-secondary)' }}>
              {batchPurge 
                ? `You are about to permanently erase ${selectedIds.length} selected synapses from disk. ` 
                : 'You are about to permanently erase this synapse from disk. '
              }
              This action is <strong>irreversible</strong> and will delete all files and indices associated with it.
            </div>
            <div className="synapse-modal__actions">
              <button className="synapse-btn synapse-btn--secondary synapse-btn--sm" onClick={() => setShowPurgeConfirm(false)}>
                Cancel
              </button>
              <button className="synapse-btn synapse-btn--danger synapse-btn--sm" onClick={confirmPurge}>
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
