import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Copy, 
  Check, 
  ExternalLink, 
  FolderOpen, 
  Image as ImageIcon, 
  Code, 
  Compass, 
  Loader2, 
  Maximize2,
  FileText,
  Clock,
  Archive,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { PLATFORM_COLORS, PLATFORM_NAMES, PLATFORM_EMOJI, showToast } from '../App.jsx';
import { hydrateCapsule } from '../bridge.js';

export default function ReplayView({ capsules, initialSelectedId }) {
  const [selectedId, setSelectedId] = useState(initialSelectedId || null);
  const [loading, setLoading] = useState(false);
  const [capsuleData, setCapsuleData] = useState(null);
  const [copiedCodeId, setCopiedCodeId] = useState('');
  const [activeImage, setActiveImage] = useState(null); // Fullscreen image preview state
  const [openArtifactId, setOpenArtifactId] = useState(null); // Accordion state for Claude Artifacts
  const [activeStep, setActiveStep] = useState(0); // active step number in chronological scroller

  const color = capsuleData ? (PLATFORM_COLORS[capsuleData.platform] || '#6366f1') : '#6366f1';

  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
    }
  }, [initialSelectedId]);

  const loadCapsuleContent = async (id) => {
    setLoading(true);
    setCapsuleData(null);
    try {
      const res = await hydrateCapsule(id);
      if (res.success && res.capsule) {
        setCapsuleData(res.capsule);
        const total = res.capsule.raw_items ? res.capsule.raw_items.length : 0;
        setActiveStep(total);
      } else {
        showToast(res.error || 'Failed to load conversation details', 'error');
      }
    } catch (err) {
      showToast('Hydration failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      loadCapsuleContent(selectedId);
    } else {
      setCapsuleData(null);
    }
  }, [selectedId]);

  const handleCopyCode = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    showToast('Code copied to clipboard', 'success');
    setTimeout(() => setCopiedCodeId(''), 2000);
  };

  const generateContinuationPromptText = () => {
    if (!capsuleData || activeStep === 0) return '';
    const visibleItems = capsuleData.raw_items ? capsuleData.raw_items.slice(0, activeStep) : [];
    
    // Find the last user and assistant turns up to the current step
    const lastUserTurn = [...visibleItems].reverse().find(x => x.role === 'user');
    const lastAITurn = [...visibleItems].reverse().find(x => x.role === 'assistant');
    
    let text = `[Context Continuity Bridge via Synapse v3]\n`;
    text += `Please continue the following conversation with full verbatim context.\n`;
    text += `Original Platform: ${PLATFORM_NAMES[capsuleData.platform] || capsuleData.platform}\n`;
    text += `Session Title: "${capsuleData.title}"\n`;
    text += `=======================================================\n\n`;
    
    if (lastUserTurn) {
      text += `--- Last User Message ---\n${lastUserTurn.content}\n\n`;
    }
    if (lastAITurn) {
      text += `--- Last Assistant Response ---\n${lastAITurn.content}\n\n`;
    }
    
    text += `=======================================================\n`;
    text += `Instruction: Acknowledge receipt of this context and proceed immediately with answering the last prompt or continuation question in full detail.`;
    return text;
  };

  if (!selectedId) {
    return (
      <div>
        <div className="synapse-page-header">
          <div className="synapse-page-header__title">Synapse Viewer</div>
          <div className="synapse-page-header__sub">
            Hydrate and view complete conversations captured from ChatGPT, Claude, and Gemini
          </div>
        </div>

        {capsules.length === 0 ? (
          <div className="synapse-empty" style={{ background: '#ffffff', border: '1px solid #e2e8f0', padding: 48, borderRadius: 12 }}>
            <div className="synapse-empty__icon">
              <Archive size={28} color="var(--accent)" />
            </div>
            <div className="synapse-empty__title">Library is empty</div>
            <div className="synapse-empty__sub">
              Capture some conversations from ChatGPT, Claude, or Gemini first, then view them here.
            </div>
          </div>
        ) : (
          <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
            <h3 style={{ marginBottom: 12, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>Select a captured thread to view:</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {capsules.map(c => {
                const color = PLATFORM_COLORS[c.platform] || '#6366f1';
                const emoji = PLATFORM_EMOJI[c.platform] || '🤖';
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                      background: '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    className="nav-button"
                  >
                    <span style={{ fontSize: 18 }}>{emoji}</span>
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.title}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Captured {new Date(c.createdAt).toLocaleDateString()} · {c.messagesCount} items · {(c.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <span
                      className="badge"
                      style={{ color, borderColor: color + '40', background: color + '12' }}
                    >
                      {PLATFORM_NAMES[c.platform] || c.platform}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="viewer-container">
      {/* Viewer Header */}
      <div className="viewer-header">
        <button 
          onClick={() => setSelectedId(null)} 
          className="btn btn-secondary" 
          style={{ 
            padding: '8px 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            borderRadius: '10px',
            background: '#ffffff',
            border: '1px solid rgba(15, 23, 42, 0.08)',
            color: 'var(--text-secondary)',
            fontSize: '0.82rem',
            fontWeight: 600,
            boxShadow: '0 2px 4px rgba(0,0,0,0.01)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            fontFamily: 'var(--font)'
          }}
        >
          <ArrowLeft size={15} strokeWidth={2.5} /> Back to list
        </button>

        {capsuleData && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            background: 'rgba(255, 255, 255, 0.6)', 
            border: '1px solid rgba(15, 23, 42, 0.04)', 
            padding: '6px 14px', 
            borderRadius: '12px', 
            backdropFilter: 'blur(8px)',
            boxShadow: '0 2px 8px rgba(15, 23, 42, 0.01)'
          }}>
            <span style={{ fontSize: 20, display: 'flex', alignItems: 'center' }}>{PLATFORM_EMOJI[capsuleData.platform]}</span>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', fontFamily: 'var(--font-headings)' }}>{capsuleData.title}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {PLATFORM_NAMES[capsuleData.platform] || capsuleData.platform} thread
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Playback & Stepper Control Deck */}
      {capsuleData && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          background: 'rgba(255, 255, 255, 0.75)',
          borderBottom: '1px solid rgba(15, 23, 42, 0.05)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          gap: 16,
          flexWrap: 'wrap',
          position: 'sticky',
          top: 0,
          zIndex: 5,
          boxShadow: '0 4px 20px -2px rgba(15, 23, 42, 0.02)'
        }}>
          {/* Active Step Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: '8px',
              background: `linear-gradient(135deg, ${color}15, ${color}25)`,
              color: color,
              border: `1px solid ${color}35`,
              fontFamily: 'var(--font-headings)'
            }}>
              Turn {activeStep} of {capsuleData.raw_items ? capsuleData.raw_items.length : 0}
            </span>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              {activeStep === 0 ? 'Start of conversation' : `Showing context up to turn ${activeStep}`}
            </span>
          </div>

          {/* Stepper buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button 
              disabled={activeStep <= 0}
              onClick={() => setActiveStep(prev => Math.max(0, prev - 1))}
              className="btn btn-secondary"
              style={{
                padding: '6px 12px',
                fontSize: '0.78rem',
                opacity: activeStep <= 0 ? 0.5 : 1,
                cursor: activeStep <= 0 ? 'not-allowed' : 'pointer',
                background: '#ffffff',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: '8px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: '0 1px 2px rgba(0,0,0,0.01)',
                transition: 'all 0.15s ease'
              }}
            >
              ← Step Back
            </button>
            
            {/* Direct Slider controller for quick scrubbing */}
            <input 
              type="range"
              min="0"
              max={capsuleData.raw_items ? capsuleData.raw_items.length : 0}
              value={activeStep}
              onChange={e => setActiveStep(Number(e.target.value))}
              style={{
                width: 160,
                accentColor: color,
                cursor: 'pointer',
                height: 5,
                borderRadius: 3
              }}
              title="Scrub through conversation history"
            />

            <button 
              disabled={capsuleData.raw_items && activeStep >= capsuleData.raw_items.length}
              onClick={() => setActiveStep(prev => Math.min(capsuleData.raw_items ? capsuleData.raw_items.length : prev, prev + 1))}
              className="btn btn-secondary"
              style={{
                padding: '6px 12px',
                fontSize: '0.78rem',
                opacity: capsuleData.raw_items && activeStep >= capsuleData.raw_items.length ? 0.5 : 1,
                cursor: capsuleData.raw_items && activeStep >= capsuleData.raw_items.length ? 'not-allowed' : 'pointer',
                background: '#ffffff',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: '8px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                boxShadow: '0 1px 2px rgba(0,0,0,0.01)',
                transition: 'all 0.15s ease'
              }}
            >
              Step Forward →
            </button>
            <button 
              disabled={capsuleData.raw_items && activeStep === capsuleData.raw_items.length}
              onClick={() => setActiveStep(capsuleData.raw_items ? capsuleData.raw_items.length : 0)}
              className="btn btn-secondary"
              style={{
                padding: '6px 12px',
                fontSize: '0.78rem',
                opacity: capsuleData.raw_items && activeStep === capsuleData.raw_items.length ? 0.5 : 1,
                cursor: capsuleData.raw_items && activeStep === capsuleData.raw_items.length ? 'not-allowed' : 'pointer',
                background: '#ffffff',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: '8px',
                color: 'var(--text-secondary)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.01)',
                transition: 'all 0.15s ease'
              }}
            >
              Jump to End ⏭
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12 }}>
          <Loader2 size={36} className="animate-spin" style={{ color: 'var(--accent-purple)' }} />
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Decompressing synapse Gzip packages...</span>
        </div>
      )}

      {/* Hydrated Chat Thread */}
      {capsuleData && (
        <div className="viewer-thread">
          {capsuleData.raw_items && capsuleData.raw_items.slice(0, activeStep).map((item, index) => {
            const role = item.role || 'unknown';
            const content = item.content || '';
            const codeBlocks = item.codeBlocks || [];
            const tables = item.tables || [];
            const images = item.images || [];
            const artifacts = item.artifacts || [];
            const citations = item.citations || [];

            if (role !== 'user' && role !== 'assistant') return null;

            return (
              <div key={item.id || index} className={`viewer-bubble ${role}`}>
                {/* Avatar */}
                <div className={`viewer-avatar ${role}`}>
                  {role === 'user' ? 'USR' : 'SYN'}
                </div>

                {/* Content Bubble Body */}
                <div className="viewer-bubble-content">
                  {/* Role Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      {role === 'user' ? 'User' : PLATFORM_NAMES[capsuleData.platform] || 'AI Assistant'}
                    </span>
                    {item.timestamp && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {/* Prose prose */}
                  <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{content}</p>

                  {/* Tables rendering */}
                  {tables && tables.length > 0 && tables.map((t, idx) => (
                    <div key={idx} style={{ overflowX: 'auto', margin: '8px 0', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        {t.headers && (
                          <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border-color)' }}>
                              {t.headers.map((h, hidx) => (
                                <th key={hidx} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: 'var(--text-secondary)' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {t.rows && t.rows.map((row, ridx) => (
                            <tr key={ridx} style={{ borderBottom: ridx < t.rows.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                              {row.map((cell, cidx) => (
                                <td key={cidx} style={{ padding: '8px 12px', color: 'var(--text-primary)' }}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  {/* Code Blocks */}
                  {codeBlocks && codeBlocks.length > 0 && codeBlocks.map((code, idx) => {
                    const blockId = `${item.id || index}-code-${idx}`;
                    return (
                      <div key={idx} className="codeblock-container" style={{ margin: '8px 0' }}>
                        <div className="codeblock-header">
                          <span>{code.language || 'code'}</span>
                          <button onClick={() => handleCopyCode(code.content, blockId)} className="codeblock-copy-btn">
                            {copiedCodeId === blockId ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                            {copiedCodeId === blockId ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre style={{ margin: 0, border: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0, background: '#f8fafc' }}>
                          <code>{code.content}</code>
                        </pre>
                      </div>
                    );
                  })}

                  {/* Images inline Base64 */}
                  {images && images.length > 0 && (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0' }}>
                      {images.map((img, idx) => {
                        const imgSrc = img.preview || img.thumbnail || img.dataUrl;
                        if (!imgSrc) return null;
                        return (
                          <div 
                            key={idx} 
                            className="inline-image-container"
                            onClick={() => setActiveImage(imgSrc)}
                          >
                            <img src={imgSrc} alt={img.metadata?.alt || "Extracted Image"} />
                            <div className="inline-image-overlay">
                              <Maximize2 size={16} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Gemini/LLM Citations */}
                  {citations && citations.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, width: '100%', fontWeight: 600 }}>
                        <Compass size={11} /> GROUNDING SOURCE CITATIONS
                      </span>
                      {citations.map((c, idx) => (
                        <a 
                          key={idx} 
                          href={c.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            fontSize: '0.75rem',
                            color: 'var(--accent-purple-hover)',
                            textDecoration: 'none',
                          }}
                        >
                          {c.text || 'Source'} <ExternalLink size={10} />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Claude Collapsible Artifact Panels */}
                  {artifacts && artifacts.length > 0 && (
                    <div className="artifact-panels-container">
                      <span style={{ fontSize: '0.72rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                        <FileText size={12} /> CLAUDE EXTRACTED ARTIFACTS
                      </span>
                      {artifacts.map((a, idx) => {
                        const artId = `${item.id || index}-art-${idx}`;
                        const isOpen = openArtifactId === artId;
                        return (
                          <div key={idx} className="artifact-card">
                            <div 
                              className="artifact-card-header"
                              onClick={() => setOpenArtifactId(isOpen ? null : artId)}
                            >
                              <div className="artifact-card-title">
                                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                {a.title || 'Untitled Artifact'}
                              </div>
                              <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>
                                {a.type || 'text'}
                              </span>
                            </div>
                            {isOpen && (
                              <div className="artifact-card-content">
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                                  <button 
                                    onClick={() => handleCopyCode(a.content, artId)}
                                    className="btn btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 4 }}
                                  >
                                    {copiedCodeId === artId ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                                    Copy Code
                                  </button>
                                </div>
                                <pre style={{ margin: 0, background: '#f8fafc', fontSize: '0.78rem' }}>
                                  <code>{a.content}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Context Continuation prompt box */}
      {capsuleData && activeStep > 0 && (
        <div style={{
          margin: '20px 24px',
          padding: '16px',
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.04) 0%, rgba(139, 92, 246, 0.04) 100%)',
          border: '1px dashed var(--accent)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.2 }}>
              ✨ SEAMLESS CONTEXT CONTINUATION PROMPT
            </span>
            <button
              onClick={() => {
                const text = generateContinuationPromptText();
                navigator.clipboard.writeText(text);
                showToast('Continuation prompt copied!', 'success');
              }}
              className="synapse-btn"
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--accent)',
                background: '#ffffff',
                color: 'var(--accent)'
              }}
            >
              <Copy size={12} /> Copy Continuation Prompt
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
            Copy this prompt and paste it into any other LLM platform (ChatGPT, Gemini, Claude) to immediately resume your conversation with verbatim continuation context:
          </p>
          <pre style={{
            margin: 0,
            padding: 12,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflowY: 'auto'
          }}>
            {generateContinuationPromptText()}
          </pre>
        </div>
      )}

      {/* Fullscreen Image Zoom Overlay Modal */}
      {activeImage && (
        <div className="modal-overlay" style={{ background: 'rgba(15,23,42,0.85)' }} onClick={() => setActiveImage(null)}>
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }} onClick={e => e.stopPropagation()}>
            <img 
              src={activeImage} 
              alt="Fullscreen Zoom View" 
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }} 
            />
            <button 
              onClick={() => setActiveImage(null)}
              className="btn btn-secondary"
              style={{ position: 'absolute', top: 12, right: 12, padding: '4px 10px', fontSize: '0.75rem', background: 'white', color: 'black', border: 'none', borderRadius: 6 }}
            >
              Close zoom
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
