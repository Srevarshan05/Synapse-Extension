import React from 'react';
import { Sparkles, FileText, Settings, Zap, HardDrive, Lock } from 'lucide-react';

export default function ImportView() {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Page Header */}
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Context Converter</div>
        <div className="synapse-page-header__sub">
          Convert local documents and codebase directories into portable .synapse prompt continuation streams
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
        className="synapse-import-grid"
      >
        {/* Main Converter Form (Read-only / Idle Staging Mode) */}
        <div className="synapse-card synapse-section-card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
          
          {/* Glassmorphic Idle Overlay */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(9, 9, 11, 0.72)',
            backdropFilter: 'blur(3px)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            textAlign: 'center'
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--accent-glow)',
              border: '1px solid var(--border-accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', marginBottom: 16,
              boxShadow: 'var(--shadow-glow)'
            }}>
              <Lock size={24} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fafafa', marginBottom: 8, fontFamily: 'var(--font-headings)' }}>
              SaaS Context Converter Staged
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#a1a1aa', maxWidth: 360, lineHeight: 1.5 }}>
              This feature is currently idle while we focus on core workspace optimizations. Complete document-to-synapse conversions will be enabled in a future release.
            </p>
          </div>

          <div className="synapse-section-card__title" style={{ fontSize: '1.05rem', fontWeight: 700, opacity: 0.2 }}>
            Generate .synapse Context Package
          </div>
          <div className="synapse-section-card__sub" style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2, marginBottom: 20, opacity: 0.2 }}>
            Convert text logs, markdown specs, code, logs or PDF documents into a clean portable .synapse context wrapper.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: 0.2 }}>
            {/* File Attachment Drop Box */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Upload Document / Attachment
              </label>
              <div
                style={{
                  border: '1px dashed var(--border)',
                  borderRadius: 10,
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'rgba(255,255,255,0.01)',
                  borderColor: 'var(--border)',
                  cursor: 'not-allowed',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <div style={{ padding: 6, borderRadius: 8, background: 'var(--accent-glow)', color: 'var(--accent)', display: 'inline-flex' }}>
                  <FileText size={18} />
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Click to select context document
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Supports txt, md, logs, code, docx, pdf
                </span>
              </div>
            </div>

            {/* Title & Platform */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Synapse Title
                </label>
                <input 
                  type="text"
                  disabled
                  placeholder="Enter context title..."
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.02)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    outline: 'none'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Target Platform
                </label>
                <select
                  disabled
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    outline: 'none',
                    height: 38,
                    cursor: 'not-allowed'
                  }}
                >
                  <option>ChatGPT</option>
                </select>
              </div>
            </div>

            {/* Custom Prompt Context Staging Instruction */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Pre-prompt / Continuation Instructions
              </label>
              <textarea
                rows={3}
                disabled
                placeholder="Define dialogue continuations behavior..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  resize: 'none',
                  lineHeight: '1.4'
                }}
              />
            </div>

            {/* Action trigger buttons split */}
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <button
                disabled
                className="synapse-btn synapse-btn--secondary"
                style={{ flex: 1, padding: '10px 16px', fontSize: '0.82rem', justifyContent: 'center', opacity: 0.5, cursor: 'not-allowed' }}
              >
                Package & Download (.synapse)
              </button>
              <button
                disabled
                className="synapse-btn synapse-btn--primary"
                style={{ flex: 1, padding: '10px 16px', fontSize: '0.82rem', justifyContent: 'center', opacity: 0.5, cursor: 'not-allowed' }}
              >
                Save Direct to Library
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Educational info card */}
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
              <Zap size={15} color="var(--accent)" />
              <span style={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                SaaS Context Packager
              </span>
            </div>
            
            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Universal Bridging
            </h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: 16 }}>
              Instantly turn documentation, API guides, codebase context specs, or complex readmes into fully hydrated chat sessions:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { icon: FileText, title: 'Deep Text Extraction', desc: 'Directly reads plain text, markdown blocks, logs and documents.' },
                { icon: HardDrive, title: 'Cursor & Local IDEs Compatible', desc: 'Use the downloaded `.synapse` package directly in local context window extensions.' },
                { icon: Settings, title: 'Automated Dialogue Staging', desc: 'Creates seamless user/assistant conversation nodes instantly.' }
              ].map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ padding: 6, borderRadius: 6, background: 'var(--accent-glow)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                    <item.icon size={13} color="var(--accent)" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{item.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: '1.4', marginTop: 1 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
