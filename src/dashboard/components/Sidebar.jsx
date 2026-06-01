import React from 'react';
import {
  LayoutDashboard,
  Archive,
  Upload,
  Download,
  Settings,
  Zap,
  Trash2,
  Sun,
  Moon,
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'overview',  label: 'Overview',  Icon: LayoutDashboard },
  { id: 'capsules',  label: 'Synapses',  Icon: Archive },
  { id: 'trash',     label: 'Trash',     Icon: Trash2 },
  { id: 'import',    label: 'Import',    Icon: Upload },
  { id: 'export',    label: 'Export',    Icon: Download },
  { id: 'settings',  label: 'Settings',  Icon: Settings },
];

export default function Sidebar({ activeView, onNavigate, capsuleCount, theme, onToggleTheme }) {
  return (
    <header className="synapse-header">
      {/* Brand Logo */}
      <div className="synapse-header__logo" onClick={() => onNavigate('overview')} style={{ cursor: 'pointer' }}>
        <div className="synapse-header__logo-icon">
          <Zap size={16} color="white" strokeWidth={2.5} />
        </div>
        <div className="synapse-header__logo-text">
          <span className="synapse-header__logo-name">Synapse</span>
          <span className="synapse-header__logo-sub">v4 · Context Engine</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="synapse-header__nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <div
            key={id}
            className={`synapse-header__nav-item${activeView === id ? ' active' : ''}`}
            onClick={() => onNavigate(id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onNavigate(id)}
            aria-label={label}
          >
            <Icon size={14} className="nav-icon" strokeWidth={activeView === id ? 2.5 : 2} />
            <span>{label}</span>
            {id === 'capsules' && capsuleCount > 0 && (
              <span className="synapse-header__nav-badge">{capsuleCount}</span>
            )}
          </div>
        ))}
      </nav>

      {/* Right-aligned Actions */}
      <div className="synapse-header__actions">
        <button
          onClick={onToggleTheme}
          className="theme-toggle-btn"
          title={theme === 'dark' ? 'Switch to Light Vercel Theme' : 'Switch to Dark Heroku Theme'}
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? (
            <Sun size={15} strokeWidth={2.5} />
          ) : (
            <Moon size={15} strokeWidth={2.5} />
          )}
        </button>
      </div>
    </header>
  );
}
