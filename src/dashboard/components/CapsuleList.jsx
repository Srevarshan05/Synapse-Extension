import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw, Archive, SlidersHorizontal, Trash2, Download, AlertTriangle, Check } from 'lucide-react';
import CapsuleCard from './CapsuleCard.jsx';
import { searchCapsules, exportCapsule } from '../bridge.js';

export default function CapsuleList({ capsules, loading, onDelete, onPin, onRefresh, onView }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef(null);
  
  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState([]);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  const runSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await searchCapsules(q);
      if (res.success) setSearchResults(res.capsules || []);
    } catch (err) {
      console.error('[Synapse] Search error:', err);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(searchTimeout.current);
  }, [query, runSearch]);

  // Reset selections when capsules change or loading finishes
  useEffect(() => {
    setSelectedIds([]);
  }, [capsules, loading]);

  // Compute display list
  let displayList = searchResults !== null ? searchResults : [...capsules];

  // Sort
  displayList = [...displayList].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (sort) {
      case 'createdAt': return b.createdAt - a.createdAt;
      case 'title':     return a.title.localeCompare(b.title);
      case 'platform':  return a.platform.localeCompare(b.platform);
      case 'completeness': return (b.completeness || 100) - (a.completeness || 100);
      default: return 0;
    }
  });

  const handleSelectToggle = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllToggle = () => {
    if (selectedIds.length === displayList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(displayList.map(c => c.id));
    }
  };

  const handleBatchDelete = () => {
    setShowBatchConfirm(true);
  };

  const confirmBatchDelete = () => {
    setShowBatchConfirm(false);
    selectedIds.forEach(id => {
      onDelete(id);
    });
    setSelectedIds([]);
  };

  const handleBatchExport = async () => {
    let successCount = 0;
    for (const id of selectedIds) {
      const cap = displayList.find(c => c.id === id);
      if (!cap) continue;
      
      try {
        const res = await exportCapsule(id);
        if (res.success && res.raw) {
          // Trigger file download in browser
          const blob = new Blob([res.raw], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${cap.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_synapse.synpkg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          successCount++;
        }
      } catch (err) {
        console.error('Batch export failed for capsule ID:', id, err);
      }
    }
    alert(`Successfully exported ${successCount} capsules!`);
  };

  return (
    <div>
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Synapse Library</div>
        <div className="synapse-page-header__sub">
          Browse, search, and batch-manage your captured LLM threads
        </div>
      </div>

      {/* Multi-Select Action Bar (Slides in when items selected) */}
      {selectedIds.length > 0 && (
        <div className="multi-actions-bar">
          <span className="multi-actions-label">
            {selectedIds.length} synapse{selectedIds.length !== 1 ? 's' : ''} selected
          </span>
          <div className="multi-actions-buttons">
            <button 
              onClick={handleBatchExport}
              className="synapse-btn synapse-btn--secondary synapse-btn--sm" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Download size={14} /> Export Selected
            </button>
            <button 
              onClick={handleBatchDelete}
              className="synapse-btn synapse-btn--danger synapse-btn--sm" 
              style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> Move to Trash
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="synapse-capsule-list__toolbar">
        {displayList.length > 0 && (
          <div 
            onClick={handleSelectAllToggle}
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              paddingRight: 8, 
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '5px',
                border: `2px solid ${displayList.length > 0 && selectedIds.length === displayList.length ? 'var(--accent)' : 'rgba(15, 23, 42, 0.2)'}`,
                background: displayList.length > 0 && selectedIds.length === displayList.length ? 'var(--accent)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              title="Select All"
            >
              {displayList.length > 0 && selectedIds.length === displayList.length && (
                <Check size={11} color="#ffffff" strokeWidth={3} />
              )}
            </div>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Select All</span>
          </div>
        )}

        <div className="synapse-search">
          <Search size={15} className="synapse-search__icon" />
          <input
            className="synapse-search__input"
            placeholder="Search synapses by title…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal size={14} color="var(--text-muted)" />
          <select
            className="synapse-sort-select"
            value={sort}
            onChange={e => setSort(e.target.value)}
          >
            <option value="createdAt">Newest first</option>
            <option value="title">A–Z Title</option>
            <option value="platform">Platform</option>
            <option value="completeness">Completeness</option>
          </select>
        </div>

        <button
          className="synapse-icon-btn"
          onClick={onRefresh}
          title="Refresh synapses"
        >
          <RefreshCw size={15} style={loading ? { animation: 'spin 0.7s linear infinite' } : {}} />
        </button>
      </div>

      {/* Count */}
      {!loading && (
        <div className="synapse-capsule-list__count">
          {searching
            ? 'Searching…'
            : `${displayList.length} active synapse${displayList.length !== 1 ? 's' : ''}${query ? ` matching "${query}"` : ''}`}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
          <LoaderCw size={24} className="animate-spin" style={{ color: 'var(--accent-purple)' }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && displayList.length === 0 && (
        <div className="synapse-empty" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', padding: 40, borderRadius: 12 }}>
          <div className="synapse-empty__icon">
            <Archive size={28} color="var(--accent)" />
          </div>
          <div className="synapse-empty__title">
            {query ? 'No results found' : 'No synapses yet'}
          </div>
          <div className="synapse-empty__sub">
            {query
              ? `No synapses match "${query}". Try a different search.`
              : 'Open ChatGPT, Claude, or Gemini in your browser and click Smart Copy to capture your first conversation.'}
          </div>
        </div>
      )}

      {/* Grid */}
      {!loading && displayList.length > 0 && (
        <div 
          className="synapse-capsule-list__grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '20px'
          }}
        >
          {displayList.map(capsule => (
            <CapsuleCard
              key={capsule.id}
              capsule={capsule}
              onDelete={onDelete}
              onPin={onPin}
              onView={onView}
              isSelected={selectedIds.includes(capsule.id)}
              onSelect={handleSelectToggle}
            />
          ))}
        </div>
      )}

      {/* Batch Delete Confirmation Modal */}
      {showBatchConfirm && (
        <div className="synapse-modal-overlay" onClick={() => setShowBatchConfirm(false)}>
          <div className="synapse-modal" onClick={e => e.stopPropagation()}>
            <div className="synapse-modal__title" style={{ color: 'var(--error)' }}>
              ⚠ Move selected synapses to Trash?
            </div>
            <div className="synapse-modal__body" style={{ color: 'var(--text-secondary)' }}>
              Are you sure you want to move <strong>{selectedIds.length}</strong> selected synapses to the Trash? 
              They will be recoverable for up to 30 days.
            </div>
            <div className="synapse-modal__actions">
              <button className="synapse-btn synapse-btn--secondary synapse-btn--sm" onClick={() => setShowBatchConfirm(false)}>
                Cancel
              </button>
              <button className="synapse-btn synapse-btn--danger synapse-btn--sm" onClick={confirmBatchDelete}>
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline fallback loader helper since Loader2 is used
function LoaderCw({ size, className, style }) {
  return <RefreshCw size={size} className={className} style={{ ...style, animation: 'spin 1.2s linear infinite' }} />;
}
