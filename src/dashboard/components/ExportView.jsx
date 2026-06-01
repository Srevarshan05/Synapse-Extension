import React, { useState } from 'react';
import { Download, CheckSquare, Square, AlertCircle, FileDown, Search, HelpCircle, Shield, Key, Share2, Compass, Layers } from 'lucide-react';
import { exportCapsule, exportCapsuleLocal } from '../bridge.js';
import { PLATFORM_COLORS, PLATFORM_NAMES, PLATFORM_EMOJI, showToast } from '../App.jsx';

function formatTimeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ExportView({ capsules }) {
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState('');

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = (filteredList) => {
    if (selected.size === filteredList.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredList.map(c => c.id)));
    }
  };

  const downloadBlob = (filename, contentBase64) => {
    const blob = new Blob([contentBase64], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (selected.size === 0) return;
    setExporting(true);
    setResults([]);
    const exportResults = [];

    for (const id of selected) {
      const capsule = capsules.find(c => c.id === id);
      try {
        const res = await exportCapsule(id);
        if (res.success && res.raw) {
          const safeName = (capsule?.title || id)
            .replace(/[^a-z0-9\-_\s]/gi, '')
            .replace(/\s+/g, '-')
            .slice(0, 60)
            .toLowerCase();
          const ts = new Date().toISOString().slice(0, 10);
          const baseFilename = `synapse-${safeName}-${ts}`;
          
          // 1. Physically save the obfuscated (.synapse) file directly into the local storage folder
          const localSaveRes = await exportCapsuleLocal(id, baseFilename);
          if (!localSaveRes.success) {
            throw new Error(localSaveRes.error || 'Failed to save to local PC storage');
          }

          // 2. Trigger browser download of the obfuscated .synapse file containing base64 content
          const base64Content = btoa(unescape(encodeURIComponent(res.raw)));
          downloadBlob(`${baseFilename}.synapse`, base64Content);
          
          exportResults.push({ id, title: capsule?.title, success: true });
          showToast(`Exported & saved locally!`, 'success');
        } else {
          exportResults.push({ id, title: capsule?.title, success: false, error: res.error || 'Export failed' });
          showToast(`Export failed for "${capsule?.title}"`, 'error');
        }
      } catch (err) {
        exportResults.push({ id, title: capsule?.title, success: false, error: err.message });
        showToast(`Export failed: ${err.message}`, 'error');
      }
    }

    setResults(exportResults);
    setExporting(false);
  };

  // Filter display list
  const filteredCapsules = capsules.filter(c => 
    c.title?.toLowerCase().includes(query.toLowerCase()) ||
    c.platform?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Page Header */}
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Export Synapses</div>
        <div className="synapse-page-header__sub">
          Package your active LLM dialogue contexts into universal portable .synapse extensions
        </div>
      </div>

      {/* Balanced Dual-Column Dashboard Grid */}
      <div 
        style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 380px', 
          gap: '24px', 
          alignItems: 'start',
          width: '100%'
        }}
        className="synapse-export-grid"
      >
        {/* Left Column: Selector list */}
        <div className="synapse-card synapse-section-card" style={{ padding: '24px', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <div className="synapse-section-card__title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>Select Synapses to Export</div>
              <div className="synapse-section-card__sub" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
                Select dialogue profiles to bundle as compressed, secure .synapse files.
              </div>
            </div>
            {capsules.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '8px', padding: '2px 8px' }}>
                <Search size={14} color="var(--text-muted)" style={{ marginRight: 6 }} />
                <input 
                  type="text"
                  placeholder="Filter by title..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                    padding: '6px 0',
                    width: 140
                  }}
                />
              </div>
            )}
          </div>

          {capsules.length === 0 ? (
            <div className="synapse-empty" style={{ padding: '64px 16px' }}>
              <div className="synapse-empty__icon" style={{ animation: 'float 4s ease-in-out infinite' }}>
                <FileDown size={30} color="var(--accent)" />
              </div>
              <div className="synapse-empty__title" style={{ fontSize: '1rem', fontWeight: 600, marginTop: 12 }}>No synapses to export</div>
              <div className="synapse-empty__sub" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Your Synapse extension library is empty. Start a conversation on ChatGPT/Claude and capture it first!
              </div>
            </div>
          ) : filteredCapsules.length === 0 ? (
            <div className="synapse-empty" style={{ padding: '48px 16px' }}>
              <div className="synapse-empty__title" style={{ fontSize: '0.95rem', fontWeight: 600 }}>No matching synapses</div>
              <div className="synapse-empty__sub" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                No dialogue profiles match "{query}". Try a different filter word.
              </div>
            </div>
          ) : (
            <>
              {/* Custom selection header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 12,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: 'var(--accent-glow-lg)',
                  border: '1px solid var(--border-accent)',
                  userSelect: 'none',
                  transition: 'all 0.15s ease'
                }}
                onClick={() => toggleAll(filteredCapsules)}
              >
                <div 
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '5px',
                    border: `2px solid ${selected.size === filteredCapsules.length ? 'var(--accent)' : 'var(--text-muted)'}`,
                    background: selected.size === filteredCapsules.length ? 'var(--accent)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
                  }}
                >
                  {selected.size === filteredCapsules.length && <span style={{ color: 'white', fontSize: 10, fontWeight: 900 }}>✓</span>}
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {selected.size === filteredCapsules.length ? 'Deselect all listed' : 'Select all listed'}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto', fontWeight: 500 }}>
                  {selected.size} of {filteredCapsules.length} selected
                </span>
              </div>

              {/* Scrollable list of synapses */}
              <div 
                className="synapse-export__capsule-list" 
                style={{ 
                  maxHeight: '340px', 
                  overflowY: 'auto', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px',
                  paddingRight: '4px',
                  marginBottom: '16px'
                }}
              >
                {filteredCapsules.map(c => {
                  const color = PLATFORM_COLORS[c.platform] || '#8b5cf6';
                  const emoji = PLATFORM_EMOJI[c.platform] || '🤖';
                  const isSelected = selected.has(c.id);
                  const result = results.find(r => r.id === c.id);
                  return (
                    <div
                      key={c.id}
                      className={`synapse-export__capsule-item${isSelected ? ' synapse-export__capsule-item--selected' : ''}`}
                      onClick={() => toggleSelect(c.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: '8px',
                        border: `1px solid ${isSelected ? 'var(--border-accent)' : 'var(--border)'}`,
                        background: isSelected ? 'var(--accent-glow-lg)' : 'var(--surface)',
                        cursor: 'pointer',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                      }}
                    >
                      <div 
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '4px',
                          border: `2px solid ${isSelected ? 'var(--accent)' : 'rgba(15, 23, 42, 0.2)'}`,
                          background: isSelected ? 'var(--accent)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s',
                          flexShrink: 0
                        }}
                      >
                        {isSelected && <span style={{ color: 'white', fontSize: 9, fontWeight: 900 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 16 }}>{emoji}</span>
                      <span 
                        className="synapse-export__capsule-name"
                        style={{ 
                          flex: 1, 
                          fontSize: '0.85rem', 
                          fontWeight: 500, 
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {c.title}
                      </span>
                      <span 
                        className="synapse-platform-badge"
                        style={{ 
                          color, 
                          borderColor: color + '30', 
                          background: color + '0f',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '6px',
                          border: '1px solid',
                          fontWeight: 600
                        }}
                      >
                        {PLATFORM_NAMES[c.platform] || c.platform}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: 50, textAlign: 'right' }}>
                        {formatTimeAgo(c.createdAt)}
                      </span>
                      {result && (
                        <span 
                          style={{ 
                            fontSize: 12, 
                            fontWeight: 700, 
                            color: result.success ? 'var(--success)' : 'var(--error)',
                            marginLeft: 4
                          }}
                        >
                          {result.success ? '✓' : '✕'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Action trigger button */}
              <button
                className="synapse-btn synapse-btn--primary"
                style={{ 
                  width: '100%', 
                  justifyContent: 'center', 
                  height: 42, 
                  fontSize: '0.88rem', 
                  borderRadius: '10px',
                  fontWeight: 600,
                  boxShadow: 'var(--shadow-glow)'
                }}
                onClick={handleExport}
                disabled={selected.size === 0 || exporting}
              >
                {exporting ? (
                  <><div className="synapse-spinner synapse-spinner--sm" style={{ borderTopColor: 'white', marginRight: 8 }} /> Packaging Synapses…</>
                ) : (
                  <><Download size={16} style={{ marginRight: 6 }} /> Export {selected.size} Synapse{selected.size !== 1 ? 's' : ''}</>
                )}
              </button>
            </>
          )}
        </div>

        {/* Right Column: Educational SaaS Workbench info card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div 
            className="synapse-card synapse-section-card"
            style={{ 
              padding: '24px', 
              background: 'linear-gradient(135deg, var(--surface) 0%, rgba(99, 102, 241, 0.02) 100%)',
              border: '1px solid var(--border)' 
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Layers size={16} color="var(--accent)" />
              <span style={{ fontSize: '0.88rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                Universal Schema
              </span>
            </div>
            
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Context Portability
            </h4>
            
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: 16 }}>
              A <strong>.synapse</strong> package is a versioned context envelope containing compressed snapshots of conversation threads, variables, extracted assets, and memory graph checkpoints.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: Share2, title: 'Multi-IDE Bridges', desc: 'Hydrate entire dialogues inside local workflows (Cursor, Antigravity, VSCode).' },
                { icon: Shield, title: 'Privacy Sandboxing', desc: 'Maintains strict PII scrubbing and encryption tokens.' },
                { icon: Key, title: 'Verbatim Continuations', desc: 'Bypasses traditional LLM context switching boundaries instantly.' }
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ padding: 6, borderRadius: 6, background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    <item.icon size={13} color="var(--accent)" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', marginTop: 1 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Success summary feed */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map(r => (
                <div
                  key={r.id}
                  className={`synapse-result-box synapse-result-box--${r.success ? 'success' : 'error'}`}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    border: '1px solid'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.success ? <Download size={14} /> : <AlertCircle size={14} />}
                    <span>{r.success ? `"${r.title}" compiled & exported` : `"${r.title}": ${r.error}`}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
